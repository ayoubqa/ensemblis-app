// Live (streaming) step output, kept in memory only (v3). The orchestrator
// writes partial text here as tokens arrive; the task serializer exposes it as
// TaskStep.liveOutput while the step is RUNNING. Lost on restart by design —
// interrupted runs are failed + refunded on startup anyway.

const live = new Map<string, string>();
const MAX_CHARS = 60_000;

export function setLiveOutput(stepId: string, text: string): void {
  live.set(stepId, text.length > MAX_CHARS ? text.slice(-MAX_CHARS) : text);
}

export function appendLiveOutput(stepId: string, delta: string): void {
  setLiveOutput(stepId, (live.get(stepId) ?? "") + delta);
}

export function getLiveOutput(stepId: string): string | null {
  return live.get(stepId) ?? null;
}

export function clearLiveOutput(stepId: string): void {
  live.delete(stepId);
}
