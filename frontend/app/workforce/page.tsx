"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Avatar, EmptyState, Icon, RequireAuth, SkeletonCard, VerifiedTag, Rating, useToast } from "@/components";
import { api, type Agent, type Task, type Workflow } from "@/lib/api";
import { eur, minutesRange, pct, plural } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

export default function WorkforcePage() {
  return (
    <RequireAuth>
      <Workforce />
    </RequireAuth>
  );
}

/** Role labels for saved agents (prototype WROLE), by category. */
const WROLE: Record<string, string> = {
  Research: "Research Analyst",
  Marketing: "Marketing Strategist",
  Sales: "Lead Researcher",
  Finance: "Financial Analyst",
  Development: "Engineer",
  Operations: "Operations Specialist",
  Legal: "Legal Analyst",
  Design: "Designer",
  "Customer Support": "Support Specialist",
  Data: "Data Analyst",
  Product: "Product Strategist",
  "Business Intelligence": "Intelligence Analyst",
};
const roleOf = (a: Agent) => WROLE[a.category] ?? `${a.taskType || a.category} Specialist`;

function Workforce() {
  const toast = useToast();
  const [saved, setSaved] = useState<Agent[] | null>(null);
  const [top, setTop] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [w, a, t, f] = await Promise.all([
        api.listWorkforce(),
        api.listAgents({ sort: "rating" }).catch(() => ({ agents: [] as Agent[], categories: [] })),
        api.listTasks().catch(() => ({ tasks: [] as Task[] })),
        api.listWorkflows().catch(() => ({ workflows: [] as Workflow[] })),
      ]);
      setSaved(w.agents);
      setTop(a.agents);
      setTasks(t.tasks);
      setWorkflows(f.workflows);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const tasksFor = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      const ids = new Set([t.agentId, ...t.steps.map((s) => s.agentId)].filter(Boolean) as string[]);
      ids.forEach((id) => m.set(id, (m.get(id) ?? 0) + 1));
    }
    return m;
  }, [tasks]);
  const myCategories = useMemo(() => {
    const m = new Map<string, number>();
    tasks.forEach((t) => t.category && m.set(t.category, (m.get(t.category) ?? 0) + 1));
    return m;
  }, [tasks]);

  const suggestions = useMemo(() => {
    const have = new Set((saved ?? []).map((a) => a.id));
    const pool = top.filter((a) => !have.has(a.id) && a.isLive);
    // Agents that already worked for you first, then your most-used categories, then top-rated.
    const score = (a: Agent) => (tasksFor.get(a.id) ?? 0) * 100 + (myCategories.get(a.category) ?? 0) * 10;
    return pool
      .map((a, i) => ({ a, s: score(a), i }))
      .sort((x, y) => y.s - x.s || x.i - y.i)
      .slice(0, 4)
      .map(({ a }) => a);
  }, [top, saved, tasksFor, myCategories]);

  const reason = (a: Agent) => {
    const n = tasksFor.get(a.id);
    if (n) return `Worked on ${plural(n, "of your tasks", "of your tasks")}`;
    const c = myCategories.get(a.category);
    if (c) return `Matches your ${a.category.toLowerCase()} work (${plural(c, "task")})`;
    return `Top rated in ${a.category} · ${pct(a.successRate)} success`;
  };

  const add = async (a: Agent) => {
    setBusy(a.id);
    try {
      await api.addToWorkforce(a.id);
      setSaved((prev) => [...(prev ?? []).filter((x) => x.id !== a.id), a]);
      toast(`${a.name} added to your workforce`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (a: Agent) => {
    setBusy(a.id);
    try {
      await api.removeFromWorkforce(a.id);
      setSaved((prev) => prev?.filter((x) => x.id !== a.id) ?? prev);
      toast.info(`${a.name} removed`, { action: { label: "Undo", onClick: () => add(a) } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="wrap" style={{ paddingBottom: 40 }}>
      <div className="pagehead row between wrapflex" style={{ alignItems: "flex-end" }}>
        <div>
          <h1>My AI Workforce</h1>
          <p>The agents your team relies on for recurring work. Over time, Ensemblis builds your workforce around the work you repeat.</p>
        </div>
        <Link className="btn" href={ROUTES.agents}>
          <Icon name="compass" />
          Explore agents
        </Link>
      </div>

      {error && (
        <div className="notice" role="alert" style={{ marginBottom: 18 }}>
          <Icon name="alert" />
          <div className="sp">{error}</div>
          <button type="button" className="btn sm" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {saved === null && !error ? (
        <div className="grid g3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : saved && saved.length === 0 ? (
        <EmptyState icon="user" title="Your workforce is empty" action={suggestions[0] ? undefined : { label: "Explore agents", href: ROUTES.agents, icon: "compass" }}>
          Save agents that do great work for you. They'll be one click away whenever you need to assign something new.
          {suggestions.length > 0 && " Start with one of the suggestions below."}
        </EmptyState>
      ) : (
        <div className="grid g3">
          {(saved ?? []).map((a) => {
            const wfN = workflows.filter((w) => w.agentId === a.id).length;
            const forYou = tasksFor.get(a.id) ?? 0;
            return (
              <article className="card" key={a.id} aria-labelledby={`wr-${a.id}`}>
                <div className="row">
                  <Avatar name={a.name} hue={a.hue} />
                  <div className="sp" style={{ minWidth: 0 }}>
                    <b id={`wr-${a.id}`}>{roleOf(a)}</b>
                    <div className="tiny muted">{a.name}</div>
                  </div>
                  <VerifiedTag verified={a.verified} compact />
                </div>
                <div className="grid g2 keep2" style={{ gap: 10, margin: "16px 0" }}>
                  <div className="stat" style={{ padding: "10px 12px" }}>
                    <b style={{ fontSize: 22 }}>{pct(a.successRate)}</b>
                    <span>success</span>
                  </div>
                  <div className="stat" style={{ padding: "10px 12px" }}>
                    <b style={{ fontSize: 22 }}>{forYou}</b>
                    <span>{forYou === 1 ? "task for you" : "tasks for you"}</span>
                  </div>
                </div>
                <div className="tiny muted" style={{ marginBottom: 12 }}>
                  {wfN ? `Used in ${plural(wfN, "workflow")}` : "Not in a workflow yet"} · typical {eur(a.pricePerTaskCents)} · {minutesRange(a.estMinutesLow, a.estMinutesHigh)}
                </div>
                <div className="row wrapflex">
                  <Link className="btn p sm" href={`${ROUTES.newTask}?agent=${encodeURIComponent(a.slug)}`}>
                    Assign work
                  </Link>
                  <Link className="btn sm" href={ROUTES.agent(a.slug)}>
                    View agent
                  </Link>
                  <button type="button" className="btn sm ghost" onClick={() => remove(a)} disabled={busy === a.id} aria-busy={busy === a.id} aria-label={`Remove ${a.name} from your workforce`} title="Remove">
                    <Icon name="x" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {suggestions.length > 0 && saved !== null && (
        <>
          <h3 style={{ margin: "28px 0 10px" }}>Suggested additions</h3>
          <div className="grid g2">
            {suggestions.map((a) => (
              <div className="card tight row" style={{ gap: 12 }} key={a.id}>
                <Avatar name={a.name} hue={a.hue} />
                <div className="sp" style={{ minWidth: 0 }}>
                  <Link href={ROUTES.agent(a.slug)} className="small" style={{ fontWeight: 700, color: "inherit" }}>
                    {a.name}
                  </Link>
                  <div className="tiny muted row" style={{ gap: 6 }}>
                    <Rating value={a.rating} /> · {reason(a)}
                  </div>
                </div>
                <button type="button" className="btn sm" onClick={() => add(a)} disabled={busy === a.id} aria-busy={busy === a.id} aria-label={`Add ${a.name} to your workforce`}>
                  <Icon name="plus" />
                  Add
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="card flat" style={{ margin: "28px 0 0" }}>
        <b>Why a workforce?</b>
        <p className="small muted" style={{ marginTop: 4, maxWidth: "64ch" }}>
          Companies repeat the same kinds of work. Keeping the agents that performed best for you close means faster starts, consistent quality, and a performance record that grows with every task.
        </p>
      </div>
    </div>
  );
}
