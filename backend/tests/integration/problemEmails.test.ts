// E-mails about a problem never quote the console's operator text: a verifier that could not run, a
// result that failed verification, a plan blocked by the AI provider's configuration or quota or by web
// search being off, and a dead job carry provider-free wording (lib/notify.ts EMAIL_DETAIL). A model's
// question is quoted without its URLs and addresses. The console keeps the full detail.
//
// MOCK AI: provider failures are errors thrown through scriptLLM (tests/helpers.ts), shaped like the
// real provider messages. Search runs against the local stub (tests/stubSearch.ts). E-mail goes to a
// captured fetch, never to Resend.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@prisma/client";
import { config } from "../../src/config";
import { prisma } from "../../src/db";
import { quotaExhaustedMessage } from "../../src/ai/llmProvider";
import { mockLLM } from "../../src/ai/mockProvider";
import { EXEC_TICK } from "../../src/engine/lifecycle";
import { onDeadJob } from "../../src/engine/worker";
import { EMAIL_DETAIL } from "../../src/lib/notify";
import { api, approvePending, createUser, defineObjective, fillContext, getExecution, runWorker, scriptLLM } from "../helpers";
import { startStubSearch, type StubSearch } from "../stubSearch";

const INVALID_KEY = "The AI provider rejected the server's API key (invalid or revoked). (Owner: check OPENAI_API_KEY in the backend's environment variables.) HTTP 401";
const QUOTA = quotaExhaustedMessage(3_600_000, "the account behind OPENAI_API_KEY");
/** Operator detail an e-mail must never carry: env var names, HTTP codes, owner hints, provider names. */
const OPERATOR = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|HTTP \d|Owner:|OpenAI|Tavily|retry after/;

type Mail = { to: string[]; subject: string; text: string; html: string };
let mails: Mail[] = [];
let stub: StubSearch | null = null;
const saved = { ...config.email };

beforeEach(() => {
  config.email.resendApiKey = "re_test";
  config.email.from = "Ensemblis <test@example.com>";
  mails = [];
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (!String(url).startsWith("https://api.resend.com/")) return realFetch(url, init);
    mails.push(JSON.parse(String(init?.body)));
    return new Response("{}", { status: 200 });
  });
});
afterEach(async () => {
  config.email.resendApiKey = saved.resendApiKey;
  config.email.from = saved.from;
  vi.restoreAllMocks();
  await stub?.close();
  stub = null;
});

/** Defines a research brief that runs without a plan approval. */
async function launchBrief(auth: Record<string, string>) {
  const res = await api()
    .post("/api/objectives")
    .set(auth)
    .send({
      statement: "Brief: how EU regulation affects liquid-cooling suppliers for European data centers, and where demand is growing.",
      kind: "research_brief",
      successCriteria: [{ description: "Every key finding cites an external source" }],
      budgetCents: 3000,
      autonomy: "AUTO_WITHIN_BUDGET",
    })
    .expect(201);
  return res.body.executionId as string;
}

/** The first e-mail whose subject starts with `prefix` (notifications are sent in the background). */
async function mailed(prefix: string): Promise<Mail> {
  return vi.waitFor(() => {
    const m = mails.find((x) => x.subject.startsWith(prefix));
    if (!m) throw new Error(`no "${prefix}" e-mail yet`);
    return m;
  });
}

/** The first e-mail whose text contains `needle`. */
async function mailedAbout(needle: string): Promise<Mail> {
  return vi.waitFor(() => {
    const m = mails.find((x) => x.text.includes(needle));
    if (!m) throw new Error(`no e-mail about "${needle}" yet`);
    return m;
  });
}

function expectProviderFree(m: Mail) {
  expect(m.text).not.toMatch(OPERATOR);
  expect(m.html).not.toMatch(OPERATOR);
}

describe("problem e-mails carry no operator detail", () => {
  for (const [label, error] of [
    ["an invalid key", INVALID_KEY],
    ["an exhausted quota", QUOTA],
  ] as const) {
    it(`the verifier is unavailable (${label}): the e-mail says so generically; the console keeps the provider's error`, async () => {
      stub = await startStubSearch();
      const { auth } = await createUser({ credits: 5000 });
      await fillContext(auth);
      scriptLLM((_s, _u, opts) => (opts.purpose === "verify" ? Promise.reject(new Error(error)) : undefined));
      const executionId = await launchBrief(auth);
      await runWorker();

      const m = await mailed("Needs your attention");
      expect(m.text).toContain("A result could not be verified");
      expect(m.text).toContain(`: ${EMAIL_DETAIL.verifierUnavailable}`);
      expect(EMAIL_DETAIL.verifierUnavailable).toBe("The AI verifier was unavailable, so the result has not been verified. Open the objective to retry or accept it.");
      expectProviderFree(m);

      const exc = (await getExecution(auth, executionId)).exceptions.find((x: { status: string }) => x.status === "OPEN");
      expect(exc.title).toBe("The result could not be verified");
      expect(exc.whatHappened).toContain("OPENAI_API_KEY");
    });
  }

  for (const [label, error, headline] of [
    ["an invalid key", INVALID_KEY, "The AI provider isn't available"],
    ["an exhausted quota", QUOTA, "The AI provider's quota is exhausted"],
  ] as const) {
    it(`planning is blocked by ${label}: the e-mail names the problem, never the provider's message`, async () => {
      stub = await startStubSearch();
      const { auth } = await createUser({ credits: 5000 });
      await fillContext(auth);
      scriptLLM((_s, _u, opts) => (opts.purpose === "plan" ? Promise.reject(new Error(error)) : undefined));
      const executionId = await launchBrief(auth);
      await runWorker();

      const m = await mailed("Needs your attention");
      expect(m.text).toContain(headline);
      expect(m.text).toContain(`: ${EMAIL_DETAIL.planBlocked}`);
      expectProviderFree(m);
      const exc = (await getExecution(auth, executionId)).exceptions.find((x: { status: string }) => x.status === "OPEN");
      expect(exc.whatHappened).toContain("OPENAI_API_KEY");
    });
  }

  it("planning is blocked because web search is off: the e-mail never names the server's settings", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    await launchBrief(auth); // SEARCH_PROVIDER=off in vitest.config.ts
    await runWorker();
    const m = await mailed("Needs your attention");
    expect(m.text).toContain("Web search is off, so the brief can't be researched");
    expect(m.text).toContain(`: ${EMAIL_DETAIL.planBlocked}`);
    expectProviderFree(m);
  });

  it("a result fails verification: the e-mail never quotes the AI verifier's text; the console keeps it", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const rationale = "Off target; the full figures are at https://other.example/q3 instead, ask ops@other.example.";
    scriptLLM((_s, _u, opts) =>
      opts.purpose === "verify" ? JSON.stringify({ objectiveAlignment: { score: 20, rationale }, criteria: [], consistencyIssues: [], humanJudgment: [] }) : undefined
    );
    const { executionId } = await defineObjective(auth);
    await runWorker();
    await approvePending(auth);
    await runWorker();

    const m = await mailedAbout("A result failed verification");
    expect(m.text).toContain(`: ${EMAIL_DETAIL.verificationFailed}`);
    expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/other\.example|Off target/);
    const exc = (await getExecution(auth, executionId)).exceptions.find((x: { status: string }) => x.status === "OPEN");
    expect(exc.kind).toBe("VERIFICATION_FAILED");
    expect(exc.whatHappened).toContain("https://other.example/q3");
  });

  it("the planner asks a question: the e-mail quotes it without its URL or address; the console keeps it whole", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const question = "Is the price list at https://other.example/q3 still current, or should we ask sales@other.example?";
    scriptLLM((system, user, opts) => {
      if (opts.purpose !== "plan") return undefined;
      const plan = JSON.parse(mockLLM(system, user, opts));
      return JSON.stringify({ ...plan, missingInformation: [{ question, whyItMatters: "Pricing drives the recommendation.", blocking: true }] });
    });
    const { executionId } = await defineObjective(auth);
    await runWorker();

    const m = await mailedAbout("The Chief of Staff has a question");
    expect(m.text).toContain(": Is the price list at still current, or should we ask?");
    expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(/other\.example|sales@/);
    const exc = (await getExecution(auth, executionId)).exceptions.find((x: { status: string }) => x.status === "OPEN");
    expect(exc.kind).toBe("MISSING_INFORMATION");
    expect(exc.questions[0].question).toBe(question);
  });

  it("a dead job fails the execution: the e-mail gives a generic reason; the console keeps the last error", async () => {
    const { auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const executionId = await launchBrief(auth); // not run: still PLANNING
    const lastError = `${INVALID_KEY} (provider: openai, key sk-proj-SECRETCANARY0123456789abcdef)`;
    await onDeadJob({ id: "job_dead", kind: EXEC_TICK, payload: { executionId }, attempts: 5, lastError } as unknown as Job);

    const m = await mailed("Execution stopped");
    expect(m.text).toContain(`: ${EMAIL_DETAIL.executionFailed} You were not charged for it.`);
    expectProviderFree(m);
    expect(`${m.text} ${m.html}`).not.toMatch(/SECRETCANARY|sk-proj|openai/i);

    const ex = await getExecution(auth, executionId);
    expect(ex.status).toBe("FAILED");
    expect(ex.errorMessage).toContain("Last error:");
    expect(ex.errorMessage).toContain("OPENAI_API_KEY");
    expect(await prisma.execution.count({ where: { id: executionId, status: "FAILED" } })).toBe(1);
  });
});
