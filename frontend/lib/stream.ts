// Live execution updates: Server-Sent Events read with fetch() so the session
// token travels in the Authorization header (never in a URL). The stream is a
// tail of the persistent event log: on reconnect it resumes from the last
// event id it saw, so nothing is missed and nothing is duplicated.

import { apiUrl, getToken, type ExecutionEvent } from "./api";

export interface StreamHandlers {
  onEvent: (e: ExecutionEvent) => void;
  onProgress?: (p: { stepId: string; partialOutput: string }) => void;
  onEnd?: (status: string) => void;
  onStatus?: (s: "live" | "reconnecting" | "closed") => void;
}

/** Incremental SSE parser: feed text chunks, get {event, data, id} messages. */
export class SSEReader {
  private buf = "";
  constructor(private readonly onMessage: (m: { event: string; data: string; id: string | null }) => void) {}
  push(chunk: string) {
    this.buf += chunk.replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = this.buf.indexOf("\n\n")) !== -1) {
      const raw = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      let event = "message";
      let id: string | null = null;
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const c = line.indexOf(":");
        const field = c === -1 ? line : line.slice(0, c);
        const value = c === -1 ? "" : line.slice(c + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
        else if (field === "id") id = value;
      }
      if (data.length) this.onMessage({ event, data: data.join("\n"), id });
    }
  }
}

/** Opens the stream; returns a function that closes it. */
export function openExecutionStream(executionId: string, after: number, h: StreamHandlers): () => void {
  let cursor = after;
  let closed = false;
  let controller: AbortController | null = null;
  let retry = 1000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    try {
      const token = getToken();
      const res = await fetch(apiUrl(`/api/executions/${encodeURIComponent(executionId)}/stream?after=${cursor}`), {
        headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
      h.onStatus?.("live");
      retry = 1000;
      let ended = false;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const sse = new SSEReader((m) => {
        if (m.event === "execution-event") {
          const e = JSON.parse(m.data) as ExecutionEvent;
          if (e.id > cursor) {
            cursor = e.id;
            h.onEvent(e);
          }
        } else if (m.event === "step-progress") {
          h.onProgress?.(JSON.parse(m.data));
        } else if (m.event === "end") {
          ended = true;
          h.onEnd?.(JSON.parse(m.data).status);
        }
      });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sse.push(decoder.decode(value, { stream: true }));
      }
      if (ended) {
        closed = true;
        h.onStatus?.("closed");
        return;
      }
    } catch {
      if (closed) return;
    }
    if (closed) return;
    // Server closed (max age / deploy / network): reconnect from the cursor.
    h.onStatus?.("reconnecting");
    timer = setTimeout(connect, retry);
    retry = Math.min(15_000, retry * 2);
  };
  void connect();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}
