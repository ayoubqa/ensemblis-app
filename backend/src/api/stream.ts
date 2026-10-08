// Live execution updates over Server-Sent Events.
//
// The source of truth is the database: this endpoint only tails the
// persistent ExecutionEvent log (id > cursor) and the persisted partial output
// of running steps. A browser that refreshes or reconnects first loads the
// full execution state (GET /api/executions/:id), then resumes the stream from
// its lastEventId (query `after` or the Last-Event-ID header) — nothing is
// lost and nothing lives only in this process's memory.
//
// One shared poller per process serves every open stream (one query per
// second per watched execution, not per connection).

import type { Request, Response } from "express";
import { prisma } from "../db";
import { toPublicEvent } from "../engine/serialize";
import { TERMINAL } from "../engine/lifecycle";

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;
const MAX_STREAM_MS = 10 * 60_000; // clients reconnect transparently
const MAX_STREAMS_PER_USER = 6;

interface Sub {
  res: Response;
  cursor: number;
  partials: Map<string, number>; // stepId -> length sent
  quietTicks: number;
  /** Ends the stream and unregisters it (idempotent). */
  finish: () => void;
}

const watched = new Map<string, Set<Sub>>();
const perUser = new Map<string, number>();
let timer: NodeJS.Timeout | null = null;
let polling = false;

const writable = (res: Response) => !res.writableEnded && !res.destroyed;

// Never write to an ended response: with no 'error' listener that throws ERR_STREAM_WRITE_AFTER_END
// out of the timer and takes the whole process down.
function send(res: Response, event: string, data: unknown, id?: number) {
  if (!writable(res)) return;
  res.write(`${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function pollOnce() {
  // A slow pass (cold database, many streams) must not overlap the next one and pile up queries.
  if (polling) return;
  polling = true;
  try {
    await pollAll();
  } finally {
    polling = false;
  }
}

async function pollAll() {
  for (const [executionId, subs] of watched) {
    if (!subs.size) {
      watched.delete(executionId);
      continue;
    }
    try {
      const minCursor = Math.min(...[...subs].map((s) => s.cursor));
      const [events, running, ex] = await Promise.all([
        prisma.executionEvent.findMany({ where: { executionId, id: { gt: minCursor } }, orderBy: { id: "asc" }, take: 200 }),
        prisma.executionStep.findMany({ where: { executionId, status: "RUNNING" }, select: { id: true, partialOutput: true } }),
        prisma.execution.findUnique({ where: { id: executionId }, select: { status: true } }),
      ]);
      for (const sub of subs) {
        let sent = false;
        for (const e of events) {
          if (e.id <= sub.cursor) continue;
          send(sub.res, "execution-event", toPublicEvent(e), e.id);
          sub.cursor = e.id;
          sent = true;
        }
        for (const r of running) {
          const text = r.partialOutput ?? "";
          // A client that isn't reading (frozen tab, stalled network) gets no more progress snapshots
          // until it drains; the next snapshot carries the latest text anyway.
          if (sub.res.writableNeedDrain) break;
          if (text.length && text.length !== sub.partials.get(r.id)) {
            sub.partials.set(r.id, text.length);
            send(sub.res, "step-progress", { stepId: r.id, partialOutput: text.slice(-12000) });
            sent = true;
          }
        }
        sub.quietTicks = sent ? 0 : sub.quietTicks + 1;
        if (ex && TERMINAL.includes(ex.status) && !sent && sub.quietTicks > 2) {
          send(sub.res, "end", { status: ex.status });
          sub.finish();
        }
      }
    } catch {
      /* transient DB error: try again next tick */
    }
  }
  if (!watched.size && timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function streamExecution(req: Request, res: Response, args: { executionId: string; userId: string }) {
  // The client may have gone while auth and the ownership check ran: 'close' has already fired then,
  // so a stream registered now would never be cleaned up (polled forever, holding a slot).
  if (req.socket.destroyed || !writable(res)) return;
  const used = perUser.get(args.userId) ?? 0;
  if (used >= MAX_STREAMS_PER_USER) {
    res.status(429).json({ error: "Too many live views open. Close a tab and try again." });
    return;
  }
  const header = Number(req.headers["last-event-id"]);
  const query = Number(req.query.after);
  const cursor = Number.isFinite(header) && header > 0 ? header : Number.isFinite(query) && query > 0 ? query : 0;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`retry: 3000\n\n`);

  let set = watched.get(args.executionId);
  if (!set) watched.set(args.executionId, (set = new Set()));
  perUser.set(args.userId, used + 1);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    clearInterval(heartbeat);
    clearTimeout(maxAge);
    set!.delete(sub);
    const n = (perUser.get(args.userId) ?? 1) - 1;
    if (n > 0) perUser.set(args.userId, n);
    else perUser.delete(args.userId);
  };
  const sub: Sub = {
    res,
    cursor,
    partials: new Map(),
    quietTicks: 0,
    finish: () => {
      cleanup();
      if (writable(res)) res.end();
    },
  };
  set.add(sub);
  if (!timer) timer = setInterval(() => void pollOnce(), POLL_MS);

  const heartbeat = setInterval(() => {
    if (writable(res)) res.write(`: ping\n\n`);
  }, HEARTBEAT_MS);
  const maxAge = setTimeout(() => {
    send(res, "reconnect", { after: sub.cursor });
    sub.finish();
  }, MAX_STREAM_MS);
  res.on("close", cleanup);
  res.on("error", cleanup);
}
