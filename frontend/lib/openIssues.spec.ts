// collectOpenIssues(): one list of everything unresolved — and "nothing open" only when
// every source is empty. resultStateOf() / usedMockAI(): honest fallbacks for an older API.
import { describe, expect, it } from "vitest";
import type { OpenIssuesInput } from "./openIssues";
import {
  collectOpenIssues,
  endpointNote,
  failedSearchSummary,
  groupOpenIssues,
  listedResultState,
  modelEndpointTag,
  researchNotice,
  resultScore,
  resultStateOf,
  unfinishedStep,
  usedCustomSearch,
  usedMockAI,
  verificationStopped,
} from "./openIssues";

const check = (status: "pass" | "warn" | "fail" | "not_assessed", key: string = status) => ({ key, label: `Check ${key}`, status, score: 50, detail: `detail ${key}` });
const claim = (status: "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "UNCITED" | "ESTIMATE", text = `claim ${status}`) => ({
  claim: text,
  status,
  evidenceNs: [1],
  supportScore: 1,
  note: "",
});
const CRITERIA = [
  { id: "c1", description: "Three markets ranked" },
  { id: "c2", description: "Each claim cited" },
];

/** Every source present, and every one of them clean. */
const clean = (): OpenIssuesInput => ({
  verification: {
    checks: [check("pass", "a"), check("not_assessed", "b")],
    claims: [claim("SUPPORTED"), claim("PARTIALLY_SUPPORTED"), claim("ESTIMATE")],
    humanJudgment: [],
    criteria: [
      { index: 1, status: "MET", measuredValue: null, measurement: "", explanation: "", evidence: [1] },
      { index: 2, status: "MET", measuredValue: null, measurement: "", explanation: "", evidence: [2] },
    ],
  },
  measurements: [
    { criterionId: "c1", result: "MET", measurement: "3 markets", explanation: "" },
    { criterionId: "c2", result: "MET", measurement: "all cited", explanation: "" },
  ],
  criteria: CRITERIA,
  plan: { missingInformation: [] },
  steps: [
    { title: "Market scan", status: "COMPLETED", researchStatus: "ok", research: { providers: ["tavily"], queries: ["q"], attempts: [] } },
    { title: "Synthesis", status: "COMPLETED", researchStatus: null },
  ],
  resultState: "verified",
  resultReasons: [],
  exceptions: [{ status: "RESOLVED", title: "Old decision" }],
});

describe("collectOpenIssues", () => {
  it("is empty for no input at all", () => {
    expect(collectOpenIssues({})).toEqual([]);
  });

  it("is empty only when every source is clean", () => {
    expect(collectOpenIssues(clean())).toEqual([]);
  });

  it("aggregates warn and fail checks (not pass or not-assessed)", () => {
    const x = clean();
    x.verification!.checks.push(check("warn", "w"), check("fail", "f"));
    const items = collectOpenIssues(x);
    expect(items.map((i) => [i.kind, i.severity, i.title, i.detail])).toEqual([
      ["check", "warn", "Check w", "detail w"],
      ["check", "bad", "Check f", "detail f"],
    ]);
    expect(items[0].href).toBe("#verification");
  });

  it("aggregates UNSUPPORTED and UNCITED claims", () => {
    const x = clean();
    x.verification!.claims.push(claim("UNSUPPORTED", "Germany grew 40% [2]"), claim("UNCITED", "Margins are 12%"));
    const items = collectOpenIssues(x);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "claim", severity: "bad", href: "#verification-claims" });
    expect(items[0].title).toContain("Germany grew 40% [2]");
    expect(items[1]).toMatchObject({ kind: "claim", severity: "warn" });
    expect(items[1].title).toContain("Margins are 12%");
  });

  it("aggregates UNKNOWN and NOT_MET measured criteria, with their description", () => {
    const x = clean();
    x.measurements = [
      { criterionId: "c1", result: "NOT_MET", measurement: "2 markets", explanation: "one missing" },
      { criterionId: "c2", result: "UNKNOWN", measurement: "", explanation: "" },
    ];
    const items = collectOpenIssues(x);
    expect(items.map((i) => [i.kind, i.severity])).toEqual([
      ["criterion", "bad"],
      ["criterion", "warn"],
    ]);
    expect(items[0].title).toBe("Criterion 1 not met: Three markets ranked");
    expect(items[0].detail).toBe("2 markets — one missing");
    expect(items[1].title).toBe("Criterion 2 not assessed: Each claim cited");
    expect(items[0].href).toBe("#outcome");
  });

  it("uses the verifier's criteria verdicts while no outcome is recorded", () => {
    const x = clean();
    x.measurements = [];
    x.verification!.criteria = [
      { index: 1, status: "NOT_MET", measuredValue: null, measurement: "", explanation: "no ranking", evidence: [] },
      { index: 2, status: "UNKNOWN", measuredValue: null, measurement: "", explanation: "", evidence: [] },
    ];
    const items = collectOpenIssues(x);
    expect(items.map((i) => i.title)).toEqual(["Criterion 1 not met: Three markets ranked", "Criterion 2 not assessed: Each claim cited"]);
    expect(items.every((i) => i.href === "#verification-criteria")).toBe(true);
  });

  it("aggregates human judgment and the plan's open questions", () => {
    const x = clean();
    x.verification!.humanJudgment = ["Whether the pricing assumption holds"];
    x.plan = { missingInformation: [{ question: "Which budget?", whyItMatters: "It sizes the plan", blocking: true }] };
    const items = collectOpenIssues(x);
    expect(items.map((i) => [i.kind, i.severity, i.title])).toEqual([
      ["judgment", "info", "Whether the pricing assumption holds"],
      ["question", "warn", "Which budget?"],
    ]);
    expect(items[1]).toMatchObject({ detail: "It sizes the plan", href: "#cs-plan" });
  });

  it("aggregates research failures with the failed searches", () => {
    const x = clean();
    x.steps = [
      {
        title: "Market scan",
        status: "COMPLETED",
        researchStatus: "failed",
        research: {
          providers: [],
          queries: ["a", "b"],
          attempts: [
            { query: "a", provider: "tavily", ok: false, httpStatus: 401, error: "Tavily rejected the key", resultCount: 0, ms: 120 },
            { query: "b", provider: "tavily", ok: false, httpStatus: 401, error: "Tavily rejected the key", resultCount: 0, ms: 0 },
            { query: "a", provider: "wikipedia", ok: false, httpStatus: null, error: "Wikipedia timed out", resultCount: 0, ms: 9000 },
          ],
        },
      },
      { title: "Competitors", status: "COMPLETED", researchStatus: "off" },
      // A skipped step's research no longer matters.
      { title: "Skipped one", status: "SKIPPED", researchStatus: "failed" },
    ];
    const items = collectOpenIssues(x);
    expect(items.map((i) => [i.kind, i.severity])).toEqual([
      ["research", "bad"],
      ["research", "warn"],
    ]);
    expect(items[0].title).toContain('"Market scan"');
    expect(items[0].detail).toBe("Tavily: HTTP 401 · Wikipedia: Wikipedia timed out");
    expect(items[0].href).toBe("#evidence");
    expect(items[1].title).toContain("Web search is off");
  });

  it("aggregates result reasons, leaving out verdicts and research already listed", () => {
    const x = clean();
    x.resultState = "partial";
    x.steps = [{ title: "Market scan", status: "COMPLETED", researchStatus: "no_results" }];
    x.resultReasons = [
      'Step "Pricing" was skipped, so the result was produced without it.',
      'Web research in "Market scan" returned no usable sources.',
      "No web research ran for this research brief.",
      "Verification passed with warnings.",
    ];
    const items = collectOpenIssues(x);
    expect(items.filter((i) => i.kind === "result").map((i) => i.title)).toEqual([
      'Step "Pricing" was skipped, so the result was produced without it.',
      "No web research ran for this research brief.",
    ]);
    expect(items.filter((i) => i.kind === "research")).toHaveLength(1);
  });

  it("marks reasons of a failed verification that was accepted as bad", () => {
    const x = clean();
    x.resultState = "accepted_failed_verification";
    x.resultReasons = ["Verification failed and the result was accepted as it is."];
    expect(collectOpenIssues(x)).toEqual([
      { kind: "result", severity: "bad", title: "Verification failed and the result was accepted as it is.", href: "#cs-execution" },
    ]);
  });

  it("never says a cancelled or failed run produced a result without the steps it never ran", () => {
    for (const state of ["cancelled", "failed"] as const) {
      const x = clean();
      x.resultState = state;
      // What an API from before this fix sends for the steps ending the run marked SKIPPED.
      x.resultReasons = [
        state === "cancelled" ? "The execution was cancelled." : "The execution failed before a result was delivered.",
        'Step "Pricing" was skipped, so the result was produced without it.',
        'Step "Market scan" failed.',
      ];
      const items = collectOpenIssues(x).filter((i) => i.kind === "result");
      expect(items.map((i) => i.title)).toEqual([x.resultReasons[0], 'Step "Market scan" failed.']);
      expect(groupOpenIssues(items, state)[0].title).toBe("Why there is no result");
    }
    // A completed result still lists the step it was produced without.
    const done = clean();
    done.resultState = "partial";
    done.resultReasons = ['Step "Pricing" was skipped, so the result was produced without it.'];
    expect(collectOpenIssues(done).map((i) => i.title)).toEqual(done.resultReasons);
    expect(groupOpenIssues(collectOpenIssues(done), "partial")[0].title).toBe("Why the result is not plainly verified");
  });

  it("lists an open exception first and drops the matching 'Paused' reason", () => {
    const x = clean();
    x.resultState = "blocked";
    x.resultReasons = ["Paused until a person resolves an open issue."];
    x.exceptions = [{ status: "OPEN", title: "The AI provider isn't configured" }];
    x.verification!.checks.push(check("warn", "w"));
    const items = collectOpenIssues(x);
    expect(items.map((i) => i.kind)).toEqual(["exception", "check"]);
    expect(items[0]).toMatchObject({ severity: "bad", title: "The AI provider isn't configured", href: "#cs-attention" });
  });

  it("orders and groups every kind", () => {
    const x: OpenIssuesInput = {
      plan: { missingInformation: [{ question: "Q?", whyItMatters: "", blocking: false }] },
      verification: { checks: [check("fail")], claims: [claim("UNCITED")], humanJudgment: ["H"] },
      measurements: [{ criterionId: "c1", result: "NOT_MET", measurement: "", explanation: "" }],
      criteria: CRITERIA,
      steps: [{ title: "S", status: "COMPLETED", researchStatus: "degraded" }],
      resultState: "partial",
      resultReasons: ["A reason."],
      exceptions: [{ status: "OPEN", title: "E" }],
    };
    const groups = groupOpenIssues(collectOpenIssues(x));
    expect(groups.map((g) => g.kind)).toEqual(["exception", "result", "research", "check", "claim", "criterion", "judgment", "question"]);
    expect(groups.every((g) => g.items.length === 1 && g.title.length > 3)).toBe(true);
  });
});

describe("failedSearchSummary", () => {
  it("names each provider and failure once, and skips successful attempts", () => {
    expect(
      failedSearchSummary([
        { query: "a", provider: "tavily", ok: true, httpStatus: 200, error: null, resultCount: 3, ms: 100 },
        { query: "b", provider: "tavily", ok: false, httpStatus: 429, error: null, resultCount: 0, ms: 100 },
        { query: "c", provider: "tavily", ok: false, httpStatus: 429, error: null, resultCount: 0, ms: 100 },
        { query: "c", provider: "wikipedia", ok: false, httpStatus: null, error: null, resultCount: 0, ms: 0 },
      ])
    ).toBe("Tavily: HTTP 429 · Wikipedia: failed");
  });
});

describe("resultStateOf", () => {
  it("prefers the API's result state", () => {
    expect(resultStateOf({ status: "COMPLETED", verificationStatus: "PASS", resultState: "partial" })).toBe("partial");
  });
  it("never reads a completed execution as verified unless verification passed", () => {
    expect(resultStateOf({ status: "COMPLETED", verificationStatus: "FAIL" })).toBe("accepted_failed_verification");
    expect(resultStateOf({ status: "COMPLETED", verificationStatus: "UNVERIFIED" })).toBe("unverified");
    expect(resultStateOf({ status: "COMPLETED", verificationStatus: null })).toBe("unverified");
    expect(resultStateOf({ status: "COMPLETED", verificationStatus: "PASS", steps: [{ kind: "work", status: "SKIPPED" }] })).toBe("partial");
    expect(resultStateOf({ status: "COMPLETED", verificationStatus: "PASS", steps: [{ kind: "revision", status: "SKIPPED" }] })).toBe("verified");
    expect(resultStateOf({ status: "COMPLETED", verificationStatus: "PASS_WITH_WARNINGS" })).toBe("verified_with_warnings");
    expect(resultStateOf({ status: "COMPLETED", verificationStatus: "PASS" })).toBe("verified");
  });
  it("maps unfinished states", () => {
    expect(resultStateOf({ status: "BLOCKED", verificationStatus: null })).toBe("blocked");
    expect(resultStateOf({ status: "FAILED", verificationStatus: null })).toBe("failed");
    expect(resultStateOf({ status: "CANCELLED", verificationStatus: null })).toBe("cancelled");
    expect(resultStateOf({ status: "VERIFYING", verificationStatus: null })).toBe("in_progress");
  });
});

describe("listedResultState", () => {
  it("names a completed result only when it is not plainly verified", () => {
    expect(listedResultState({ status: "COMPLETED", verificationStatus: "PASS", resultState: "verified" })).toBeNull();
    expect(listedResultState({ status: "COMPLETED", verificationStatus: "PASS", resultState: "partial" })).toBe("partial");
    expect(listedResultState({ status: "COMPLETED", verificationStatus: "PASS", resultState: "verified_with_warnings" })).toBe("verified_with_warnings");
    // Without the API's result state, from the verification alone.
    expect(listedResultState({ status: "COMPLETED", verificationStatus: "UNVERIFIED" })).toBe("unverified");
    expect(listedResultState({ status: "COMPLETED", verificationStatus: "FAIL" })).toBe("accepted_failed_verification");
    expect(listedResultState({ status: "COMPLETED", verificationStatus: "PASS" })).toBeNull();
  });
  it("leaves unfinished and ended executions to their status", () => {
    expect(listedResultState({ status: "CANCELLED", verificationStatus: null, resultState: "cancelled" })).toBeNull();
    expect(listedResultState({ status: "RUNNING", verificationStatus: null })).toBeNull();
    expect(listedResultState(null)).toBeNull();
  });
  it("carries a score only for a verification that ran", () => {
    expect(resultScore({ verificationStatus: "FAIL", verificationScore: 42 })).toBe("42");
    expect(resultScore({ verificationStatus: "UNVERIFIED", verificationScore: 0 })).toBeNull();
    expect(resultScore({ verificationStatus: "PASS", verificationScore: null })).toBeNull();
  });
});

describe("unfinishedStep", () => {
  const T0 = "2026-10-01T10:00:00.000Z";
  const T1 = "2026-10-01T10:01:00.000Z";
  const step = (status: "SKIPPED" | "COMPLETED" | "FAILED" | "PENDING", startedAt: string | null, completedAt: string | null, attempts = startedAt ? 1 : 0) => ({
    status,
    startedAt,
    completedAt,
    attempts,
  });
  it("tells the steps an ended run didn't finish from a person's skip", () => {
    for (const status of ["CANCELLED", "FAILED"] as const) {
      // Ending the run marked it SKIPPED before it started: Not run.
      expect(unfinishedStep(step("SKIPPED", null, null), status)).toBe("not_run");
      // The run ended while it was working (or waiting to retry): Stopped.
      expect(unfinishedStep(step("SKIPPED", T0, null), status)).toBe("stopped");
      // A person skipped it after it failed (failing set completedAt): still Skipped.
      expect(unfinishedStep(step("SKIPPED", T0, T1), status)).toBeNull();
      // Retried after it failed, then the run ended: the completedAt is the earlier failure's.
      expect(unfinishedStep(step("SKIPPED", T1, T0, 1), status)).toBe("stopped");
      expect(unfinishedStep(step("SKIPPED", T0, T1, 0), status)).toBe("stopped");
      expect(unfinishedStep(step("COMPLETED", T0, T1), status)).toBeNull();
      expect(unfinishedStep(step("FAILED", T0, null), status)).toBeNull();
    }
    // Only an ended run leaves steps unfinished.
    expect(unfinishedStep(step("SKIPPED", null, null), "COMPLETED")).toBeNull();
    expect(unfinishedStep(step("SKIPPED", T0, T1), "COMPLETED")).toBeNull();
    expect(unfinishedStep(step("SKIPPED", T0, null), "RUNNING")).toBeNull();
  });

  it("says the verification gate stopped only when the run ended after every work step finished", () => {
    const work = (s: ReturnType<typeof step>) => ({ ...s, kind: "work" as const });
    const done = [work(step("COMPLETED", T0, T1)), work(step("COMPLETED", T0, T1))];
    expect(verificationStopped({ status: "CANCELLED", verification: null, steps: done })).toBe(true);
    expect(verificationStopped({ status: "FAILED", verification: null, steps: done })).toBe(true);
    // A step a person skipped counts as finished; one the run never reached does not.
    expect(verificationStopped({ status: "CANCELLED", verification: null, steps: [done[0], work(step("SKIPPED", T0, T1))] })).toBe(true);
    expect(verificationStopped({ status: "CANCELLED", verification: null, steps: [done[0], work(step("SKIPPED", null, null))] })).toBe(false);
    expect(verificationStopped({ status: "CANCELLED", verification: null, steps: [done[0], work(step("SKIPPED", T0, null))] })).toBe(false);
    // A recorded verification, a run still going, or no steps at all.
    expect(verificationStopped({ status: "CANCELLED", verification: { status: "PASS" }, steps: done })).toBe(false);
    expect(verificationStopped({ status: "VERIFYING", verification: null, steps: done })).toBe(false);
    expect(verificationStopped({ status: "CANCELLED", verification: null, steps: [] })).toBe(false);
  });
});

describe("endpoints", () => {
  it("labels a stub or local model and a custom search endpoint from what the execution recorded", () => {
    expect(modelEndpointTag({ endpoints: { model: "stub", search: "custom" } })).toBe("Test stub endpoint — not a real model");
    expect(modelEndpointTag({ endpoints: { model: "local", search: null } })).toBe("Local model endpoint");
    expect(modelEndpointTag({ endpoints: { model: "hosted", search: "public" } })).toBeNull();
    // The mock model records no endpoint (its own label says it); an older API sends none.
    expect(modelEndpointTag({ endpoints: { model: null, search: "custom" } })).toBeNull();
    expect(modelEndpointTag({})).toBeNull();
    expect(usedCustomSearch({ endpoints: { model: null, search: "custom" } })).toBe(true);
    expect(usedCustomSearch({ endpoints: { model: "hosted", search: "public" } })).toBe(false);
    expect(usedCustomSearch(null)).toBe(false);
  });

  it("builds the export note from the model and search parts that apply", () => {
    expect(endpointNote({ endpoints: { model: "stub", search: "custom" } })).toBe(
      "Test stub endpoint — not a real model. Custom search endpoint — sources come from TAVILY_BASE_URL, not the public Tavily API."
    );
    expect(endpointNote({ endpoints: { model: "local", search: "public" } })).toBe("Local model endpoint.");
    expect(endpointNote({ endpoints: { model: null, search: "custom" } })).toBe("Custom search endpoint — sources come from TAVILY_BASE_URL, not the public Tavily API.");
    expect(endpointNote({ endpoints: { model: "hosted", search: "public" } })).toBeNull();
    expect(endpointNote(undefined)).toBeNull();
  });
});

describe("usedMockAI", () => {
  it("labels output from what the execution ran on, or a mock server", () => {
    expect(usedMockAI({ usedMockAI: true })).toBe(true);
    expect(usedMockAI({ usedMockAI: false, steps: [{ provider: "openai" }] })).toBe(false);
    expect(usedMockAI({ steps: [{ provider: "mock" }] })).toBe(true);
    expect(usedMockAI({ usedMockAI: false }, true)).toBe(true);
    expect(usedMockAI(null)).toBe(false);
  });
});

describe("researchNotice", () => {
  const attempt = (provider: string, ok: boolean, httpStatus: number | null, error: string | null = null) => ({ query: "q", provider, ok, httpStatus, error, resultCount: ok ? 2 : 0, ms: 100 });
  const web = [{ kind: "WEB" as const }];

  it("says nothing when research went fine", () => {
    expect(researchNotice([{ title: "Scan", status: "COMPLETED", researchStatus: "ok", research: { providers: ["tavily"], queries: ["q"], attempts: [attempt("tavily", true, 200)] } }], web, true)).toBeNull();
  });

  it("says when web search is off", () => {
    expect(researchNotice([{ title: "Scan", status: "COMPLETED", researchStatus: "off" }], [], true)).toEqual({ tone: "warn", text: "No web research ran: web search is off on this server." });
  });

  it("names the step and the provider failure when research failed", () => {
    const n = researchNotice([{ title: "Scan", status: "COMPLETED", researchStatus: "failed", research: { providers: [], queries: ["q"], attempts: [attempt("tavily", false, 401), attempt("wikipedia", false, null, "timed out")] } }], [], true);
    expect(n?.tone).toBe("warn");
    expect(n?.text).toBe("Web research failed in “Scan” — Tavily failed (HTTP 401), Wikipedia failed (timed out). No external sources were retrieved there.");
  });

  it("says a fallback was used when research was degraded", () => {
    const n = researchNotice([{ title: "Scan", status: "COMPLETED", researchStatus: "degraded", research: { providers: ["wikipedia"], queries: ["q"], attempts: [attempt("tavily", false, 401), attempt("wikipedia", true, 200)] } }], web, true);
    expect(n).toEqual({ tone: "info", text: "Tavily failed (HTTP 401) — Wikipedia used instead." });
  });

  it("says when search found nothing usable", () => {
    expect(researchNotice([{ title: "Scan", status: "COMPLETED", researchStatus: "no_results" }], [], true)?.text).toBe("Search ran but returned no usable sources.");
    expect(researchNotice([{ title: "Scan", status: "COMPLETED", researchStatus: "no_results" }], web, true)?.tone).toBe("info");
  });

  it("ignores skipped steps and says no research ran once the execution is finished", () => {
    const steps = [{ title: "Scan", status: "SKIPPED" as const, researchStatus: "failed" as const }];
    expect(researchNotice(steps, [{ kind: "COMPANY_CONTEXT" }], true)?.text).toBe("No web research ran in this execution: its evidence was provided, not retrieved from the web.");
    expect(researchNotice(steps, [], false)).toBeNull();
  });
});
