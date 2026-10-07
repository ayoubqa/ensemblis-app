"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, type AgentDetail, type ClarifyQuestion, type Depth, type TaskEstimate } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { PageSkeleton, useToast } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { num } from "@/lib/format";
import { signupUrl } from "@/lib/routes";
import { Describe } from "./_components/Describe";
import { Analyze } from "./_components/Analyze";
import { Plan } from "./_components/Plan";
import { loadDraft, saveDraft } from "./_components/draft";
import { clarificationBlock, cleanQuestions, hasClarifications, type ClarifyAnswer } from "./_components/Clarify";
import { useAttachments } from "./_components/attachments/useAttachments";
import { AttachGate, AttachmentPanel } from "./_components/attachments/AttachmentPanel";

type Step = "describe" | "analyze" | "plan";

/** Clarifying questions never hold the flow up for longer than this. */
const CLARIFY_TIMEOUT_MS = 6000;
/** Guest trial accounts may only run Focused tasks. */
const GUEST_DEPTHS: Depth[] = ["focused"];

interface ClarifyState {
  /** The exact (trimmed) brief the questions are about. */
  for: string;
  status: "pending" | "done";
  questions: ClarifyQuestion[];
  /** Skipped or applied — don't show them again. */
  dismissed: boolean;
}

function stepFromHash(): Step {
  if (typeof window === "undefined") return "describe";
  const h = window.location.hash.replace("#", "");
  return h === "analyze" || h === "plan" ? h : "describe";
}

export default function NewTaskPage() {
  return (
    <Suspense fallback={<PageSkeleton cards={1} />}>
      <NewTaskFlow />
    </Suspense>
  );
}

/**
 * Describe → Analyze → Plan, as one page. The step lives in the URL hash so
 * browser back/forward moves between steps; the draft (incl. uploaded
 * attachment ids) lives in sessionStorage so a visitor can sign in at confirm
 * time and come straight back.
 */
function NewTaskFlow() {
  const params = useSearchParams();
  const toast = useToast();
  const { user, loading: authLoading } = useAuth();
  const { config, loaded: configLoaded } = useConfig();
  const isGuest = !!user?.isGuest;
  const attachOn = configLoaded && config.maxAttachments > 0;
  const canAttach = attachOn && !!user && !user.isGuest;

  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<Step>("describe");
  const [description, setDescription] = useState("");
  const [depth, setDepth] = useState<Depth>("standard");
  const [agentId, setAgentId] = useState<string | null>(null);
  const [direct, setDirect] = useState<AgentDetail | null>(null);
  const [directLoading, setDirectLoading] = useState(false);

  const [estimate, setEstimate] = useState<TaskEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estError, setEstError] = useState<string | null>(null);
  const [recommendedId, setRecommendedId] = useState<string | null>(null);
  /** Description the analysis animation already ran for (skip it when navigating back). */
  const [analyzedFor, setAnalyzedFor] = useState<string | null>(null);
  const [analyzeRun, setAnalyzeRun] = useState(0);
  const reqRef = useRef(0);

  const [clarify, setClarify] = useState<ClarifyState | null>(null);
  const clarifyReq = useRef(0);

  const att = useAttachments({ max: config.maxAttachments, maxChars: config.maxAttachmentChars, userId: user?.id ?? null });
  /** Set once the task is created, so the cleared draft isn't written back. */
  const startedRef = useRef(false);

  const runEstimate = useCallback(
    async (opts: { description: string; depth: Depth; agentId: string | null }) => {
      const id = ++reqRef.current;
      setEstimating(true);
      setEstError(null);
      try {
        const { estimate } = await api.estimateTask({
          description: opts.description.trim(),
          depth: opts.depth,
          agentId: opts.agentId ?? undefined,
        });
        if (id !== reqRef.current) return null;
        setEstimate(estimate);
        if (!opts.agentId) setRecommendedId(estimate.leadAgent.id);
        return estimate;
      } catch (e) {
        if (id !== reqRef.current) return null;
        setEstError(errorText(e, "Couldn't plan this task"));
        return null;
      } finally {
        if (id === reqRef.current) setEstimating(false);
      }
    },
    []
  );

  const go = useCallback((s: Step, replace = false) => {
    const url = window.location.pathname + window.location.search + (s === "describe" ? "" : `#${s}`);
    if (replace) window.history.replaceState(window.history.state, "", url);
    else window.history.pushState(window.history.state, "", url);
    setStep(s);
    window.scrollTo({ top: 0 });
  }, []);

  // ---- Initial state from ?q= / ?agent= / ?resume=1 / #step / saved draft
  useEffect(() => {
    const q = params.get("q");
    const agentParam = params.get("agent") || params.get("agentId");
    const depthParam = params.get("depth");
    const resume = params.get("resume") === "1";
    const draft = loadDraft();

    const desc = q ?? draft?.description ?? "";
    const d: Depth =
      depthParam === "focused" || depthParam === "deep" || depthParam === "standard" ? depthParam : draft?.depth ?? "standard";
    const ag = agentParam ?? (q ? null : draft?.agentId ?? null);
    setDescription(desc);
    setDepth(d);
    setAgentId(ag);
    // A fresh ?q= brief starts clean; otherwise bring back the files already uploaded for this draft.
    if (!q && draft?.attachments.length) att.restore(draft.attachments);

    if (agentParam) {
      setDirectLoading(true);
      api
        .getAgent(agentParam)
        .then(({ agent }) => {
          setDirect(agent);
          setAgentId(agent.id);
        })
        .catch(() => {
          setAgentId(null);
          toast.error("That agent isn't available right now. Ensemblis will choose the best fit instead.");
        })
        .finally(() => setDirectLoading(false));
    }

    const wanted = stepFromHash();
    if ((resume || wanted !== "describe") && desc.trim().length >= 3) {
      // Coming back from sign-in, or a refresh mid-flow: go straight to the plan.
      const clean = window.location.pathname + (resume ? "" : window.location.search) + "#plan";
      window.history.replaceState(window.history.state, "", clean);
      setStep("plan");
      setAnalyzedFor(desc.trim());
      runEstimate({ description: desc, depth: d, agentId: ag });
    } else if (wanted !== "describe") {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Back / forward between steps
  useEffect(() => {
    const onPop = () => {
      const s = stepFromHash();
      setStep(s);
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("hashchange", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("hashchange", onPop);
    };
  }, []);

  // If history lands on analyze/plan without anything to show, fall back.
  useEffect(() => {
    if (!ready) return;
    if (step !== "describe" && !estimate && !estimating && !estError) {
      if (description.trim().length >= 3) runEstimate({ description, depth, agentId });
      else go("describe", true);
    }
  }, [ready, step, estimate, estimating, estError, description, depth, agentId, runEstimate, go]);

  // ---- Guests run Focused tasks only (the server enforces it; keep the plan honest)
  useEffect(() => {
    if (!ready || !isGuest || depth === "focused") return;
    setDepth("focused");
    if (step !== "describe") runEstimate({ description, depth: "focused", agentId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isGuest, depth]);

  // ---- Persist the draft (attachments: ids + display meta only)
  useEffect(() => {
    if (ready && !startedRef.current) saveDraft({ description, depth, agentId, attachments: att.saved });
  }, [ready, description, depth, agentId, att.saved]);

  // ---- Off the Describe step there's no drop zone: don't let a stray file drop navigate away.
  useEffect(() => {
    if (step === "describe") return;
    const stop = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, [step]);

  /** Ask for 0–3 clarifying questions in parallel with the estimate; never blocks for more than CLARIFY_TIMEOUT_MS. */
  const startClarify = (desc: string) => {
    const id = ++clarifyReq.current;
    if (!configLoaded || !config.clarifyEnabled || hasClarifications(desc)) {
      setClarify(null);
      return;
    }
    if (clarify && clarify.for === desc && clarify.status === "done") return; // already asked about this exact brief
    setClarify({ for: desc, status: "pending", questions: [], dismissed: false });
    let settled = false;
    const finish = (questions: ClarifyQuestion[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (id !== clarifyReq.current) return;
      setClarify((c) => (c && c.for === desc ? { ...c, status: "done", questions } : c));
    };
    const timer = window.setTimeout(() => finish([]), CLARIFY_TIMEOUT_MS);
    api
      .clarify(desc)
      .then((r) => finish(cleanQuestions(r?.questions)))
      .catch(() => finish([]));
  };

  const submit = () => {
    const desc = description.trim();
    setEstimate(null);
    setAnalyzedFor(null);
    setAnalyzeRun((n) => n + 1);
    startClarify(desc);
    go("analyze");
    runEstimate({ description: desc, depth, agentId });
  };

  const skipQuestions = () => {
    setClarify((c) => (c ? { ...c, dismissed: true } : c));
    go("plan");
  };

  const applyAnswers = (answers: ClarifyAnswer[]): string | null => {
    const next = description.trim() + clarificationBlock(answers);
    if (next.length > config.maxDescriptionLength)
      return `With these answers your brief would pass ${num(config.maxDescriptionLength)} characters. Shorten an answer, or skip.`;
    setDescription(next);
    setClarify((c) => (c ? { ...c, dismissed: true } : c));
    setAnalyzedFor(next);
    go("plan");
    runEstimate({ description: next, depth, agentId });
    return null;
  };

  const changeDepth = (d: Depth) => {
    if (isGuest && d !== "focused") return;
    setDepth(d);
    if (step === "plan") runEstimate({ description, depth: d, agentId });
  };

  const pickAgent = (id: string | null) => {
    setAgentId(id);
    if (!id || id !== direct?.id) setDirect(null);
    runEstimate({ description, depth, agentId: id });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const clearDirect = () => {
    setDirect(null);
    setAgentId(null);
    setEstimate(null);
  };

  if (!ready) return <PageSkeleton cards={1} />;

  const depthAllowed = isGuest ? GUEST_DEPTHS : undefined;
  const depthNote = isGuest ? (
    <>
      Guest trials run <b>Focused</b> tasks.{" "}
      <Link href={signupUrl("company", "/new")} style={{ color: "var(--accent)", fontWeight: 600 }}>
        Create a free account
      </Link>{" "}
      for Standard and Deep.
    </>
  ) : undefined;

  if (step === "analyze") {
    const brief = description.trim();
    const c = clarify && clarify.for === brief ? clarify : null;
    return (
      <Analyze
        key={analyzeRun}
        description={brief}
        estimate={estimate}
        error={estError}
        instant={analyzedFor === brief}
        onRetry={() => runEstimate({ description, depth, agentId })}
        onBack={() => go("describe")}
        onContinue={() => go("plan")}
        onAnimated={() => setAnalyzedFor(brief)}
        clarify={c ? { pending: c.status === "pending", questions: c.dismissed ? [] : c.questions } : null}
        onSkipQuestions={skipQuestions}
        onApplyAnswers={applyAnswers}
      />
    );
  }

  if (step === "plan") {
    return (
      <Plan
        description={description.trim()}
        estimate={estimate}
        busy={estimating}
        error={estError}
        depth={depth}
        onDepth={changeDepth}
        onPickAgent={pickAgent}
        recommendedId={recommendedId}
        onEdit={() => go("describe")}
        onRetry={() => runEstimate({ description, depth, agentId })}
        attachments={user && !user.isGuest ? att.ready : []}
        canAttach={canAttach}
        onDropAttachments={att.clearAll}
        onStarted={() => {
          startedRef.current = true;
        }}
        depthAllowed={depthAllowed}
        depthNote={depthNote}
      />
    );
  }

  return (
    <Describe
      description={description}
      onDescription={(v) => {
        setDescription(v);
        if (estimate) setEstimate(null);
      }}
      depth={depth}
      onDepth={changeDepth}
      agentId={agentId}
      direct={direct}
      directLoading={directLoading}
      onClearDirect={clearDirect}
      onSubmit={submit}
      materials={
        !attachOn || authLoading ? undefined : canAttach ? (
          <AttachmentPanel att={att} max={config.maxAttachments} />
        ) : (
          <AttachGate guest={isGuest} />
        )
      }
      canAttach={canAttach}
      attachBusy={canAttach ? att.busyCount : 0}
      depthAllowed={depthAllowed}
      depthNote={depthNote}
    />
  );
}
