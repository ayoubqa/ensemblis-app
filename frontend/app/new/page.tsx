"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, type AgentDetail, type Depth, type TaskEstimate } from "@/lib/api";
import { PageSkeleton, useToast } from "@/components";
import { Describe } from "./_components/Describe";
import { Analyze } from "./_components/Analyze";
import { Plan } from "./_components/Plan";
import { loadDraft, saveDraft } from "./_components/draft";

type Step = "describe" | "analyze" | "plan";

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
 * browser back/forward moves between steps; the draft lives in sessionStorage
 * so a logged-out visitor can sign in at confirm time and come straight back.
 */
function NewTaskFlow() {
  const params = useSearchParams();
  const toast = useToast();

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
        setEstError(e instanceof Error ? e.message : "Couldn't plan this task");
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

  // ---- Persist the draft
  useEffect(() => {
    if (ready) saveDraft({ description, depth, agentId });
  }, [ready, description, depth, agentId]);

  const submit = () => {
    const desc = description.trim();
    setEstimate(null);
    setAnalyzedFor(null);
    setAnalyzeRun((n) => n + 1);
    go("analyze");
    runEstimate({ description: desc, depth, agentId });
  };

  const changeDepth = (d: Depth) => {
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

  if (step === "analyze") {
    return (
      <Analyze
        key={analyzeRun}
        description={description.trim()}
        estimate={estimate}
        error={estError}
        instant={analyzedFor === description.trim()}
        onRetry={() => runEstimate({ description, depth, agentId })}
        onBack={() => go("describe")}
        onContinue={() => go("plan")}
        onAnimated={() => setAnalyzedFor(description.trim())}
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
      onDepth={setDepth}
      agentId={agentId}
      direct={direct}
      directLoading={directLoading}
      onClearDirect={clearDirect}
      onSubmit={submit}
    />
  );
}
