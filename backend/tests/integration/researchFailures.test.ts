// How a research brief fails, honestly: every case below is a provider, search
// or verification failure the engine must report as what it is — never as a
// verified result — and never charge for work that couldn't run.
//
// MOCK AI: the model is the deterministic mock provider; provider failures are
// errors thrown through scriptLLM (tests/helpers.ts), shaped like the real
// provider messages. Search runs against the local stub (tests/stubSearch.ts),
// whose Tavily/Wikipedia answers and HTTP errors are scripted, not live.
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { quotaExhaustedMessage } from "../../src/ai/llmProvider";
import { VERIFICATION_COST_CENTS } from "../../src/org/registry";
import { api, balance, createUser, fillContext, getExecution, runWorker, scriptLLM } from "../helpers";
import { INJECTION_RESULT, startStubSearch, STUB_RESULTS, UNSAFE_RESULTS, type StubSearch } from "../stubSearch";

let stub: StubSearch | null = null;
afterEach(async () => {
  await stub?.close();
  stub = null;
});

type Ev = { type: string; stepId: string | null; message: string; data: Record<string, unknown> };
const events = async (executionId: string): Promise<Ev[]> =>
  (await prisma.executionEvent.findMany({ where: { executionId }, orderBy: { id: "asc" } })) as unknown as Ev[];

const STATEMENT = "Brief: how EU regulation affects liquid-cooling suppliers for European data centers, and where demand is growing.";
const CRITERIA = [{ description: "Every key finding cites an external source" }, { description: "States the open questions" }];

/** Defines a research brief that runs without a plan approval (autonomy within budget). */
async function launchBrief(auth: Record<string, string>, body: Record<string, unknown> = {}) {
  const res = await api()
    .post("/api/objectives")
    .set(auth)
    .send({ statement: STATEMENT, kind: "research_brief", successCriteria: CRITERIA, budgetCents: 3000, autonomy: "AUTO_WITHIN_BUDGET", ...body })
    .expect(201);
  return res.body.executionId as string;
}

const openException = async (auth: Record<string, string>, executionId: string) =>
  (await getExecution(auth, executionId)).exceptions.find((x: { status: string }) => x.status === "OPEN");

const resolve = (auth: Record<string, string>, exceptionId: string, action: string, status = 200) =>
  api().post(`/api/exceptions/${exceptionId}/resolve`).set(auth).send({ action }).expect(status);

const isStep = (system: string, specialist: string) => new RegExp(`^You are the ${specialist} on`).test(system);

describe("research brief failure modes (mock AI, stub search)", () => {
  it("(1) web search off: blocked as PROVIDER_UNAVAILABLE before any charge; with search on, Retry re-plans and completes", async () => {
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const executionId = await launchBrief(auth); // SEARCH_PROVIDER=off in vitest.config.ts
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    expect(ex.resultState).toBe("blocked");
    expect(ex.plan.blocked).toMatchObject({ kind: "search_unavailable" });
    expect(ex.costCents).toBe(0);
    expect(await balance(user.id)).toBe(5000);
    const exc = await openException(auth, executionId);
    expect(exc).toMatchObject({ kind: "PROVIDER_UNAVAILABLE", severity: "HIGH", actions: ["retry", "cancel"] });
    let types = (await events(executionId)).map((e) => e.type);
    expect(types).not.toContain("FUNDS_CHARGED");
    expect(types).not.toContain("STEP_STARTED");
    expect(await prisma.transaction.count({ where: { executionId } })).toBe(0);

    // The operator turns search on (here: the local stub); Retry plans again — it does not start the blocked plan.
    stub = await startStubSearch();
    await resolve(auth, exc.id, "retry");
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("PLANNING");
    expect(ex.costCents).toBe(0);
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(ex.plan.blocked ?? null).toBeNull();
    expect(ex.steps.some((s: { researchStatus: string | null }) => s.researchStatus === "ok")).toBe(true);
    types = (await events(executionId)).map((e) => e.type);
    expect(types.filter((t) => t === "FUNDS_CHARGED")).toHaveLength(1);
  });

  it("(2) a planner configuration error blocks at planning, before any charge (and Retry re-plans once fixed)", async () => {
    stub = await startStubSearch();
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    let broken = true;
    scriptLLM((_s, _u, opts) =>
      broken && opts.purpose === "plan" ? Promise.reject(new Error("The AI provider isn't configured: OPENAI_API_KEY is missing on the server.")) : undefined
    );
    const executionId = await launchBrief(auth);
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    expect(ex.plan.blocked).toMatchObject({ kind: "config" });
    expect(ex.costCents).toBe(0);
    const exc = await openException(auth, executionId);
    expect(exc).toMatchObject({ kind: "PROVIDER_UNAVAILABLE", title: "The AI provider isn't available", actions: ["retry", "cancel"] });
    expect(exc.whatHappened).toMatch(/OPENAI_API_KEY is missing/);
    expect(await prisma.transaction.count({ where: { executionId } })).toBe(0);
    expect(await balance(user.id)).toBe(5000);
    expect(stub.calls()).toBe(0); // nothing ran

    broken = false;
    await resolve(auth, exc.id, "retry");
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(await prisma.transaction.count({ where: { executionId, type: "TASK_CHARGE" } })).toBe(1);
  });

  it("(2b) an exhausted planner quota blocks as 'quota', not as a playbook plan", async () => {
    stub = await startStubSearch();
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    scriptLLM((_s, _u, opts) => (opts.purpose === "plan" ? Promise.reject(new Error(quotaExhaustedMessage(20 * 60_000))) : undefined));
    const executionId = await launchBrief(auth);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    expect(ex.plan.blocked).toMatchObject({ kind: "quota" });
    expect(ex.costCents).toBe(0);
    expect((await openException(auth, executionId)).kind).toBe("PROVIDER_UNAVAILABLE");
  });

  it("(3) a step quota error is not retried: one attempt, a quota recommendation", async () => {
    stub = await startStubSearch();
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    scriptLLM((system, _u, opts) =>
      opts.purpose === "step" && isStep(system, "Research Analyst") ? Promise.reject(new Error(quotaExhaustedMessage(30 * 60_000, "the account behind OPENAI_API_KEY"))) : undefined
    );
    const executionId = await launchBrief(auth);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    const step = ex.steps.find((s: { capability: string }) => s.capability === "business_research");
    expect(step).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(step.error).toMatch(/quota is exhausted/);
    const evs = await events(executionId);
    expect(evs.filter((e) => e.type === "STEP_RETRY_SCHEDULED")).toHaveLength(0);
    expect(evs.find((e) => e.type === "STEP_FAILED")!.data).toMatchObject({ attempt: 1, kind: "quota", retryable: false });
    const exc = await openException(auth, executionId);
    expect(exc).toMatchObject({ kind: "STEP_FAILED", actions: ["retry", "skip", "cancel"] });
    expect(exc.recommendation).toMatch(/quota is exhausted/);
    expect(exc.recommendation).not.toMatch(/most failures are temporary/);
  });

  it("(4) Tavily rejects the key (401): the Wikipedia fallback answers, research is 'degraded' and says so", async () => {
    stub = await startStubSearch({ status: 401, wikipedia: STUB_RESULTS, retryAfter: "0" });
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const executionId = await launchBrief(auth);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    const step = ex.steps.find((s: { researchStatus: string | null }) => s.researchStatus);
    expect(step.researchStatus).toBe("degraded");
    expect(step.research.providers).toEqual(["wikipedia"]);
    expect(step.research.attempts.some((a: { provider: string; httpStatus: number | null }) => a.provider === "tavily" && a.httpStatus === 401)).toBe(true);
    // After the 401 Tavily is skipped (not called again on every query, which would burn the budget).
    expect(stub.tavilyCalls()).toBe(1);
    expect(stub.wikipediaCalls()).toBeGreaterThan(0);
    const done = (await events(executionId)).find((e) => e.type === "RESEARCH_COMPLETED")!;
    expect(done.data).toMatchObject({ status: "degraded", providers: ["wikipedia"] });
    expect(done.message).toMatch(/searched Wikipedia/);
    expect(done.message).toMatch(/Tavily: HTTP 401/);
    const rows = await prisma.evidence.findMany({ where: { executionId, kind: { in: ["WEB", "WIKIPEDIA"] } } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((e) => e.kind === "WIKIPEDIA" && e.provider === "wikipedia")).toBe(true);
    // Degraded research is reported with the result state, never hidden.
    expect(ex.resultReasons.join(" ")).toMatch(/degraded/);
    expect(ex.usage.searches).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: "tavily", failed: 1 }), expect.objectContaining({ provider: "wikipedia", failed: 0 })])
    );
  });

  it("(5) every search fails: RESEARCH_FAILED → FAIL 'Insufficient evidence' → one revision with research → exception; accepting keeps it failed", async () => {
    stub = await startStubSearch({ status: 500, wikipedia: 500, retryAfter: "0" });
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const executionId = await launchBrief(auth);
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    const evs = await events(executionId);
    const failed = evs.filter((e) => e.type === "RESEARCH_FAILED");
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0].data).toMatchObject({ status: "failed", providers: [] });
    expect(evs.some((e) => e.type === "RESEARCH_COMPLETED")).toBe(false);
    expect(await prisma.evidence.count({ where: { executionId, kind: { in: ["WEB", "WIKIPEDIA"] } } })).toBe(0);

    // Round 1 fails for lack of external evidence; exactly one automatic revision, which researched again.
    const rounds = await prisma.verification.findMany({ where: { executionId }, orderBy: { round: "asc" } });
    expect(rounds.map((r) => r.status)).toEqual(["FAIL", "FAIL"]);
    expect(ex.verification.checks.find((c: { key: string }) => c.key === "citation_support")).toMatchObject({ status: "fail" });
    expect(JSON.stringify(ex.verification.checks)).toMatch(/Insufficient evidence/);
    expect(ex.revisionCount).toBe(1);
    const revision = await prisma.executionStep.findFirstOrThrow({ where: { executionId, kind: "revision" } });
    expect(revision.inputs).toMatchObject({ research: true });
    expect(revision.researchStatus).toBe("failed");
    expect(evs.find((e) => e.type === "REVISION_REQUESTED")!.data).toMatchObject({ research: true, insufficientEvidence: true });

    const exc = await openException(auth, executionId);
    expect(exc).toMatchObject({ kind: "VERIFICATION_FAILED", title: "The result didn't pass verification", actions: ["accept", "retry", "cancel"] });
    await resolve(auth, exc.id, "accept");
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(ex.verificationStatus).toBe("FAIL"); // never relabelled as passed
    expect(ex.resultState).toBe("accepted_failed_verification");
    expect(["PARTIALLY_ACHIEVED", "NOT_ACHIEVED", "UNKNOWN"]).toContain(ex.outcomeStatus);
    // The criterion that needs external sources is not met; no criterion is backed by evidence that doesn't exist.
    const external = ex.verification.criteria.find((c: { index: number }) => c.index === 1);
    expect(external.status).toBe("NOT_MET");
    for (const m of ex.measurements) expect(m.evidenceNs).toEqual([]);
  });

  it("(6) the verifier is unavailable (HTTP 503): one delayed re-verify, then 'could not be verified'; accepting leaves it UNVERIFIED with the fee refunded", async () => {
    stub = await startStubSearch();
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    scriptLLM((_s, _u, opts) =>
      opts.purpose === "verify" ? Promise.reject(new Error("The AI provider is having problems right now (HTTP 503). key=tvly-SECRETCANARY123456")) : undefined
    );
    const executionId = await launchBrief(auth);
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    const rounds = await prisma.verification.findMany({ where: { executionId }, orderBy: { round: "asc" } });
    expect(rounds.map((r) => r.status)).toEqual(["UNVERIFIED", "UNVERIFIED"]);
    expect(rounds[0].method).toBe("deterministic");
    expect(rounds[0].assessorError).toMatch(/HTTP 503/);
    expect(ex.revisionCount).toBe(0); // not a reason to rewrite the result
    const vc = (await events(executionId)).filter((e) => e.type === "VERIFICATION_COMPLETED");
    expect(vc).toHaveLength(2);
    expect(vc[0].message).toMatch(/verifying again in/);
    const exc = await openException(auth, executionId);
    expect(exc).toMatchObject({ kind: "VERIFICATION_FAILED", title: "The result could not be verified", actions: ["accept", "retry", "cancel"] });

    const charged = 5000 - (await balance(user.id));
    await resolve(auth, exc.id, "accept");
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(ex.verificationStatus).toBe("UNVERIFIED");
    expect(ex.resultState).toBe("unverified");
    expect(ex.outcomeStatus).toBe("UNKNOWN");
    expect(ex.measurements.every((m: { result: string }) => m.result === "UNKNOWN")).toBe(true);
    expect(ex.refundedCents).toBe(VERIFICATION_COST_CENTS);
    expect(await balance(user.id)).toBe(5000 - charged + VERIFICATION_COST_CENTS);
    expect((await events(executionId)).some((e) => e.type === "FUNDS_REFUNDED" && /verification fee/.test(e.message))).toBe(true);
    // The key in the provider error was masked everywhere it was stored.
    const blob = JSON.stringify(await events(executionId)) + JSON.stringify(rounds) + JSON.stringify(ex);
    expect(blob).not.toMatch(/SECRETCANARY/);
  });

  it("(7) injected instructions and unsafe URLs in search results: the canary never surfaces, forged markers are neutralised, a javascript: URL is never stored or linked", async () => {
    const CANARY = "CANARY-7731";
    stub = await startStubSearch({ results: [...STUB_RESULTS, INJECTION_RESULT, ...UNSAFE_RESULTS] });
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    // The mock model never follows injected instructions, so the meaningful checks are on what the
    // engine does: the forged evidence markers are neutralised in every prompt that carries the page.
    const prompts: string[] = [];
    scriptLLM((_s, user) => {
      if (user.includes(CANARY)) prompts.push(user);
      return undefined;
    });
    const executionId = await launchBrief(auth);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");

    // The injected page is stored as data (it is a source) — but its forged markers can't close or open evidence blocks.
    const injected = await prisma.evidence.findFirst({ where: { executionId, url: INJECTION_RESULT.url } });
    expect(injected).not.toBeNull();
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) {
      expect(p).not.toContain('<evidence n="99"');
      expect(p).not.toContain('trust="trusted"');
      expect(p.match(/<\/evidence>/g) ?? []).toHaveLength(1); // only the real closing marker
    }
    // The canary never reaches the result or the event log.
    expect(ex.result).not.toContain(CANARY);
    expect(JSON.stringify(await events(executionId))).not.toContain(CANARY);

    // A javascript: URL is never stored, so it can never become a link; nor is the metadata address linked in the result.
    const urls = (await prisma.evidence.findMany({ where: { executionId } })).map((e) => e.url ?? "");
    expect(urls.some((u) => /^javascript:/i.test(u))).toBe(false);
    expect(JSON.stringify(ex.evidence)).not.toMatch(/javascript:/i);
    expect(JSON.stringify(await events(executionId))).not.toMatch(/javascript:/i);
    expect(ex.result).not.toMatch(/javascript:|169\.254\.169\.254/i);
  });

  // research/search.ts drops result URLs on non-public hosts (safeHttpUrl), so a search result pointing
  // at the cloud metadata address never becomes an Evidence URL or a link in the console.
  it("(7b) a search result URL on the cloud metadata address is never stored as evidence", async () => {
    stub = await startStubSearch({ results: [...STUB_RESULTS, ...UNSAFE_RESULTS] });
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const executionId = await launchBrief(auth);
    await runWorker();
    expect((await getExecution(auth, executionId)).status).toBe("COMPLETED");
    const urls = (await prisma.evidence.findMany({ where: { executionId } })).map((e) => e.url ?? "");
    // The safe results are kept; the metadata-address result is dropped before it becomes evidence.
    expect(urls.some((u) => u.startsWith("https://research.example.org/"))).toBe(true);
    expect(urls.some((u) => u.includes("169.254.169.254"))).toBe(false);
  });

  it("(8) a key inside a provider error never reaches step errors, events, exceptions, the API or the public report", async () => {
    stub = await startStubSearch();
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const leak = "socket hang up (Authorization: Bearer gsk_SECRETCANARY1234567890; search key tvly-SECRETCANARY123456)";
    scriptLLM((system, _u, opts) => (opts.purpose === "step" && isStep(system, "Planning Analyst") ? Promise.reject(new Error(leak)) : undefined));
    const executionId = await launchBrief(auth);
    await runWorker();
    let ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("BLOCKED");
    const framing = ex.steps.find((s: { capability: string }) => s.capability === "objective_framing");
    expect(framing).toMatchObject({ status: "FAILED", attempts: 3 });
    expect(framing.error).toMatch(/socket hang up/);
    const exc = await openException(auth, executionId);
    expect(exc.whatHappened).toMatch(/socket hang up/);
    const stored = async () =>
      JSON.stringify(await prisma.executionStep.findMany({ where: { executionId } })) +
      JSON.stringify(await events(executionId)) +
      JSON.stringify(await prisma.exception.findMany({ where: { executionId } })) +
      JSON.stringify(await prisma.usageEvent.findMany({ where: { executionId } }));
    expect(await stored()).not.toMatch(/SECRETCANARY/);
    expect(JSON.stringify(ex)).not.toMatch(/SECRETCANARY/);

    // Continue without the step (it keeps its redacted error), then share: the public report is clean too.
    await resolve(auth, exc.id, "skip");
    await runWorker();
    ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(ex.steps.find((s: { capability: string }) => s.capability === "objective_framing")).toMatchObject({ status: "SKIPPED" });
    const share = await api().post(`/api/executions/${executionId}/share`).set(auth).send({ enabled: true }).expect(200);
    const pub = (await api().get(`/api/public/reports/${share.body.shareToken}`).expect(200)).body.report;
    expect(JSON.stringify(pub)).not.toMatch(/SECRETCANARY/);
    expect(JSON.stringify(ex)).not.toMatch(/SECRETCANARY/);
    expect(await stored()).not.toMatch(/SECRETCANARY/);
  });

  it("(9) a step that fails once after its research reuses it on the retry: no new searches, no duplicate evidence", async () => {
    stub = await startStubSearch();
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    let failures = 0;
    let callsAtFailure = -1;
    scriptLLM((system, _u, opts) => {
      if (opts.purpose === "step" && isStep(system, "Research Analyst") && failures < 1) {
        failures++;
        callsAtFailure = stub!.calls();
        throw new Error("The AI provider is having problems right now (HTTP 503). Please try again later.");
      }
      return undefined;
    });
    const executionId = await launchBrief(auth);
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    const step = await prisma.executionStep.findFirstOrThrow({ where: { executionId, capability: "business_research" } });
    expect(step.attempts).toBe(2);
    expect(step.researchStatus).toBe("ok");
    expect(callsAtFailure).toBeGreaterThan(0);
    expect(stub.calls()).toBe(callsAtFailure); // the retry searched nothing (and nothing later did)
    const evs = await events(executionId);
    expect(evs.filter((e) => e.stepId === step.id && e.type === "RESEARCH_STARTED")).toHaveLength(1);
    expect(evs.filter((e) => e.stepId === step.id && e.type === "RESEARCH_COMPLETED")).toHaveLength(1);
    const rows = await prisma.evidence.findMany({ where: { executionId } });
    expect(new Set(rows.map((e) => e.url ?? `${e.kind}:${e.title}`)).size).toBe(rows.length);
    expect(rows.filter((e) => e.stepId === step.id && e.kind === "WEB")).toHaveLength(STUB_RESULTS.length);
    expect(evs.filter((e) => e.type === "SOURCE_FOUND")).toHaveLength(rows.length);
  });

  it("(10) continue without a failed work step: COMPLETED as 'partial', the step's cost refunded, its error kept", async () => {
    stub = await startStubSearch();
    const { auth, user } = await createUser({ credits: 5000 });
    await fillContext(auth);
    scriptLLM((system, _u, opts) => (opts.purpose === "step" && isStep(system, "Planning Analyst") ? Promise.reject(new Error("socket hang up")) : undefined));
    const executionId = await launchBrief(auth);
    await runWorker();
    const exc = await openException(auth, executionId);
    expect(exc).toMatchObject({ kind: "STEP_FAILED", actions: ["retry", "skip", "cancel"] });
    const failed = await prisma.executionStep.findFirstOrThrow({ where: { executionId, status: "FAILED" } });
    const before = await balance(user.id);
    await resolve(auth, exc.id, "skip");
    await runWorker();
    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("COMPLETED");
    expect(ex.resultState).toBe("partial");
    expect(ex.resultReasons.join(" ")).toMatch(/skipped/);
    const step = ex.steps.find((s: { id: string }) => s.id === failed.id);
    expect(step.status).toBe("SKIPPED");
    expect(step.error).toMatch(/socket hang up/);
    expect(ex.refundedCents).toBe(failed.costCents);
    expect(await balance(user.id)).toBe(before + failed.costCents);
    const types = (await events(executionId)).map((e) => e.type);
    expect(types).toContain("STEP_SKIPPED");
    // The brief itself lists the skipped step under its evidence gaps.
    expect(ex.result).toMatch(/## Evidence gaps[\s\S]*was skipped/);
    // The Exception Center history records how it was resolved.
    const resolved = (await api().get("/api/exceptions?status=ALL").set(auth).expect(200)).body.exceptions.find((x: { id: string }) => x.id === exc.id);
    expect(resolved.resolvedAction).toBe("skip");
  });
});
