"use client";

// Live objective state. The page always renders a full snapshot from the API
// (GET /api/objectives/:id) — that is what a refresh or a reconnect rebuilds
// from. While the execution is in progress it tails the persistent event log
// over SSE: each event is shown immediately and triggers a (debounced)
// snapshot refresh; streamed step text updates the running step in place.
// If streaming is unavailable it falls back to polling the snapshot.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ExecutionEvent, type ObjectiveDetail } from "@/lib/api";
import { openExecutionStream } from "@/lib/stream";
import { isLiveStatus } from "@/components";

export type StreamState = "idle" | "live" | "reconnecting" | "polling";

const ACTIVE = new Set(["PLANNING", "PLANNED", "RUNNING", "VERIFYING"]);

export function useObjectiveLive(id: string) {
  const [detail, setDetail] = useState<ObjectiveDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [stream, setStream] = useState<StreamState>("idle");
  const [partials, setPartials] = useState<Record<string, string>>({});
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.getObjective(id);
      setDetail(d);
      setError(null);
      return d;
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("Something went wrong", 500));
      return null;
    }
  }, [id]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => void load(), 350);
  }, [load]);

  useEffect(() => {
    void load();
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [load]);

  const executionId = detail?.execution?.id ?? null;
  const status = detail?.execution?.status ?? null;
  const live = !!status && ACTIVE.has(status);
  const lastEventId = detail?.execution?.lastEventId ?? 0;
  const lastEventRef = useRef(lastEventId);
  lastEventRef.current = lastEventId;

  // Tail the event log while work is in progress.
  useEffect(() => {
    if (!executionId || !live) {
      setStream("idle");
      return;
    }
    let failures = 0;
    const close = openExecutionStream(executionId, lastEventRef.current, {
      onEvent: (e: ExecutionEvent) => {
        setDetail((d) => {
          if (!d?.execution || d.execution.id !== executionId || d.execution.events.some((x) => x.id === e.id)) return d;
          return { ...d, execution: { ...d.execution, events: [...d.execution.events, e], lastEventId: e.id } };
        });
        scheduleRefetch();
      },
      onProgress: (p) => setPartials((m) => ({ ...m, [p.stepId]: p.partialOutput })),
      onEnd: () => scheduleRefetch(),
      onStatus: (s) => {
        if (s === "reconnecting") failures++;
        setStream(s === "live" ? "live" : s === "reconnecting" ? (failures > 3 ? "polling" : "reconnecting") : "idle");
      },
    });
    return close;
  }, [executionId, live, scheduleRefetch]);

  // Safety net: while live, refresh the snapshot every 15s (or 4s if the stream is down).
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), stream === "live" ? 15_000 : 4_000);
    return () => clearInterval(t);
  }, [live, stream, load]);

  // Waiting states change only through people: refresh on focus.
  useEffect(() => {
    const on = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [load]);

  return { detail, error, reload: load, stream, partials, setDetail, isLive: isLiveStatus(status) };
}
