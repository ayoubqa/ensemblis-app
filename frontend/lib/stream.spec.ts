import { afterEach, describe, expect, it, vi } from "vitest";
import { SSEReader, openExecutionStream } from "./stream";
import type { ExecutionEvent } from "./api";

describe("SSEReader", () => {
  it("parses events split across chunks, ignoring comments/heartbeats", () => {
    const got: { event: string; data: string; id: string | null }[] = [];
    const r = new SSEReader((m) => got.push(m));
    r.push(": heartbeat\n\n");
    r.push("id: 7\nevent: execution-event\ndata: {\"id\":7");
    expect(got).toHaveLength(0);
    r.push("}\n\nevent: end\ndata: {\"status\":\"COMPLETED\"}\n\n");
    expect(got).toEqual([
      { event: "execution-event", data: '{"id":7}', id: "7" },
      { event: "end", data: '{"status":"COMPLETED"}', id: null },
    ]);
  });

  it("handles CRLF line endings and multi-line data", () => {
    const got: string[] = [];
    const r = new SSEReader((m) => got.push(m.data));
    r.push("data: line one\r\ndata: line two\r\n\r\n");
    expect(got).toEqual(["line one\nline two"]);
  });
});

function sseBody(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

const ev = (id: number, type = "STEP_COMPLETED"): ExecutionEvent =>
  ({ id, type, message: `event ${id}`, createdAt: new Date(0).toISOString() }) as unknown as ExecutionEvent;

const frame = (e: ExecutionEvent) => `id: ${e.id}\nevent: execution-event\ndata: ${JSON.stringify(e)}\n\n`;

describe("openExecutionStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resumes from the last seen event id after a disconnect and never duplicates", async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    const responses = [
      // First connection drops after event 2 (no "end").
      sseBody(frame(ev(1)) + frame(ev(2))),
      // The server replays from the cursor; a stale duplicate (2) must be ignored.
      sseBody(frame(ev(2)) + frame(ev(3, "EXECUTION_COMPLETED")) + 'event: end\ndata: {"status":"COMPLETED"}\n\n'),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(responses.shift() ?? sseBody(""), { status: 200 });
      })
    );
    const seen: number[] = [];
    const statuses: string[] = [];
    let endStatus = "";
    openExecutionStream("ex1", 0, {
      onEvent: (e) => seen.push(e.id),
      onEnd: (s) => (endStatus = s),
      onStatus: (s) => statuses.push(s),
    });
    await vi.waitFor(() => expect(statuses).toContain("reconnecting"));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(endStatus).toBe("COMPLETED"));
    expect(seen).toEqual([1, 2, 3]);
    expect(urls[0]).toContain("/api/executions/ex1/stream?after=0");
    expect(urls[1]).toContain("after=2");
    expect(statuses.at(-1)).toBe("closed");
  });

  it("stops reconnecting once closed by the caller", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(sseBody(""), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const close = openExecutionStream("ex2", 5, { onEvent: () => undefined });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
