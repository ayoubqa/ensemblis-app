"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, type Task } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { errorText } from "@/lib/errors";
import {
  Avatar,
  EmptyState,
  Icon,
  OutcomeTag,
  PageHead,
  PageSkeleton,
  RequireAuth,
  Skeleton,
  Stat,
  StatusTag,
} from "@/components";
import { dayLabel, durationBetween, eur, num } from "@/lib/format";
import { useIsMobile, useKeyboardShortcut, usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";

type Filter = "All" | "Active" | "Completed" | "Failed";
type Scope = "all" | "mine" | "team";
const SCOPE_LABEL: Record<Scope, string> = { all: "All", mine: "Started by me", team: "Team" };
const parseScope = (v: string | null): Scope => (v === "mine" || v === "team" ? v : "all");
const FILTERS: Filter[] = ["All", "Active", "Completed", "Failed"];

const isActive = (t: Task) => t.status === "RUNNING" || t.status === "PLANNING";
const match = (t: Task, f: Filter) =>
  f === "All" ||
  (f === "Active" ? isActive(t) : f === "Completed" ? t.status === "COMPLETED" : t.status === "FAILED" || t.status === "REFUNDED");

export default function TasksPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<PageSkeleton />}>
        <MyWork />
      </Suspense>
    </RequireAuth>
  );
}

/** Small inline markers next to a task title: who started it (team), test run, shared link. */
function TaskMarks({ t, meId }: { t: Task; meId?: string }) {
  const by = t.createdBy && meId && t.createdBy.id !== meId ? t.createdBy.name : null;
  if (!by && !t.isTest && !t.shareToken) return null;
  return (
    <span className="row wrapflex" style={{ gap: 6, marginTop: 4, display: "flex" }}>
      {by && (
        <span className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Icon name="user" size={12} />
          by {by}
        </span>
      )}
      {t.isTest && (
        <span className="tag warn" style={{ padding: "1px 7px", fontSize: 11 }} title="A free developer test run of an agent">
          Test run
        </span>
      )}
      {t.shareToken && (
        <span className="tag gray" style={{ padding: "1px 7px", fontSize: 11 }} title="Anyone with the public link can read this report">
          <Icon name="link" />
          Shared
        </span>
      )}
    </span>
  );
}

function progressOf(t: Task) {
  const n = t.steps.length || 1;
  return Math.round((t.steps.filter((s) => s.status === "COMPLETED").length / n) * 100);
}

function execTime(t: Task) {
  if (t.status === "COMPLETED") return durationBetween(t.startedAt ?? t.createdAt, t.completedAt);
  if (isActive(t)) return `${t.steps.filter((s) => s.status === "COMPLETED").length}/${t.steps.length} steps`;
  return "—";
}

function MyWork() {
  const router = useRouter();
  const pathname = usePathname() || "/tasks";
  const params = useSearchParams();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const inTeam = !!user?.team;
  const [scope, setScopeState] = useState<Scope>(() => parseScope(params.get("scope")));
  const effectiveScope: Scope = scope === "team" && !inTeam ? "all" : scope;
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef<Scope>(effectiveScope);
  scopeRef.current = effectiveScope;

  const setScope = (s: Scope) => {
    if (s === scope) return;
    setScopeState(s);
    setTasks(null);
    setError(null);
    const next = new URLSearchParams(params.toString());
    if (s === "all") next.delete("scope");
    else next.set("scope", s);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const fetchTasks = async () => {
    const asked = scopeRef.current;
    try {
      const r = await api.listTasks(asked === "all" ? undefined : asked);
      if (asked !== scopeRef.current) return true; // the scope changed mid-request; the next tick refetches
      setTasks(r.tasks);
      setError(null);
      return r.tasks.some(isActive);
    } catch (e) {
      if (asked !== scopeRef.current) return true;
      setError(errorText(e, "Couldn't load your tasks."));
      return true;
    }
  };

  const anyActive = !!tasks?.some(isActive);
  usePolling(fetchTasks, anyActive ? 4000 : 15000, { enabled: tasks === null || anyActive || !!error });
  // Switching scope: fetch right away instead of waiting for the next tick.
  const firstScope = useRef(true);
  useEffect(() => {
    if (firstScope.current) {
      firstScope.current = false;
      return;
    }
    void fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveScope]);

  useKeyboardShortcut("f", () => searchRef.current?.focus());

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { All: 0, Active: 0, Completed: 0, Failed: 0 };
    (tasks ?? []).forEach((t) => FILTERS.forEach((f) => match(t, f) && c[f]++));
    return c;
  }, [tasks]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tasks ?? []).filter(
      (t) =>
        match(t, filter) &&
        (!needle ||
          [t.title, t.description, t.category ?? "", t.agent?.name ?? "", t.createdBy?.name ?? ""].some((x) => x.toLowerCase().includes(needle)))
    );
  }, [tasks, filter, q]);

  const spent = useMemo(
    () => (tasks ?? []).filter((t) => !t.isTest && (t.status === "COMPLETED" || isActive(t))).reduce((n, t) => n + t.costCents, 0),
    [tasks]
  );
  const rated = (tasks ?? []).filter((t) => t.outcome);
  const achieved = rated.filter((t) => t.outcome === "Achieved").length;

  return (
    <div className="wrap">
      <PageHead
        title="Task history"
        sub={
          inTeam
            ? `Everything you and ${user?.team?.name ?? "your team"} have asked for, with results, cost and outcomes.`
            : "Everything you've asked for, with results, cost and outcomes."
        }
        actions={
          <Link className="btn p" href={ROUTES.newTask}>
            <Icon name="plus" />
            New task
          </Link>
        }
      />

      <div className="row wrapflex" style={{ gap: 8, marginBottom: 16 }} role="group" aria-label="Whose tasks to show">
        {(["all", "mine", ...(inTeam ? (["team"] as const) : [])] as Scope[]).map((s) => {
          const on = effectiveScope === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              className={on ? "chip on" : "chip"}
              onClick={() => setScope(s)}
              style={{ fontWeight: 600 }}
            >
              {s === "team" && <Icon name="share" size={14} />}
              {s === "team" ? `${SCOPE_LABEL.team}${user?.team ? ` · ${user.team.name}` : ""}` : SCOPE_LABEL[s]}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="notice" role="alert" style={{ marginBottom: 16 }}>
          <Icon name="alert" />
          <span>{error} We&apos;ll keep retrying.</span>
        </div>
      )}

      {tasks === null ? (
        !error && (
          <div aria-busy="true" aria-label="Loading your tasks">
            <div className="grid g4 keep2" style={{ marginBottom: 20 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="stat">
                  <Skeleton width="50%" height={22} />
                  <Skeleton width="70%" height={10} style={{ marginTop: 8 }} />
                </div>
              ))}
            </div>
            <div className="tw">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="row" style={{ padding: "14px", borderBottom: "1px solid var(--line)", gap: 16 }}>
                  <Skeleton width="38%" height={14} />
                  <Skeleton width="12%" height={14} />
                  <Skeleton width="10%" height={14} />
                  <Skeleton width="8%" height={14} />
                </div>
              ))}
            </div>
          </div>
        )
      ) : tasks.length === 0 ? (
        <div style={{ marginBottom: 40 }}>
          {effectiveScope === "team" ? (
            <EmptyState icon="share" title="No team tasks yet" action={{ label: "Start a task for the team", href: ROUTES.newTask, icon: "plus" }}>
              Tasks anyone on {user?.team?.name ?? "your team"} runs show up here, with who started each one.
            </EmptyState>
          ) : effectiveScope === "mine" ? (
            <EmptyState icon="spark" title="You haven't started a task yet" action={{ label: "Describe a task", href: ROUTES.newTask, icon: "plus" }}>
              Describe an outcome in plain language. Ensemblis plans it, runs a team of agents and delivers a verified report.
            </EmptyState>
          ) : (
            <EmptyState icon="spark" title="No tasks yet" action={{ label: "Describe your first task", href: ROUTES.newTask, icon: "plus" }}>
              Describe an outcome in plain language. Ensemblis plans it, runs a team of agents and delivers a verified report, usually in
              minutes. Not sure what to ask?{" "}
              <Link href={ROUTES.examples} style={{ color: "var(--accent)", fontWeight: 600 }}>
                See example reports
              </Link>
              .
            </EmptyState>
          )}
        </div>
      ) : (
        <>
          <div className="grid g4 keep2" style={{ marginBottom: 20 }}>
            <Stat value={num(tasks.length)} label="tasks requested" />
            <Stat value={num(counts.Active)} label="running now" />
            <Stat value={eur(spent)} label="spent on delivered work" />
            <Stat value={rated.length ? `${Math.round((achieved / rated.length) * 100)}%` : "—"} label="rated as achieved" />
          </div>

          <div className="row wrapflex between" style={{ gap: 10, marginBottom: 16 }}>
            <div className="row wrapflex" style={{ gap: 8 }} role="group" aria-label="Filter tasks">
              {FILTERS.map((f) => (
                <button key={f} type="button" className={filter === f ? "chip on" : "chip"} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "Active" && counts.Active > 0 && <span className="pulse" aria-hidden="true" />}
                  {f}
                  <span style={{ opacity: 0.65, fontWeight: 500 }}>{counts[f]}</span>
                </button>
              ))}
            </div>
            <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
              <label htmlFor="task-search" className="sr-only">
                Search tasks
              </label>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", display: "flex" }}>
                <Icon name="search" size={16} />
              </span>
              <input
                id="task-search"
                ref={searchRef}
                className="f"
                type="search"
                placeholder="Search tasks, agents, categories"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQ("")}
                style={{ paddingLeft: 36 }}
              />
            </div>
          </div>

          {list.length === 0 ? (
            <div style={{ marginBottom: 40 }}>
              <EmptyState
                icon="search"
                title={q ? `Nothing matches “${q}”` : `No ${filter.toLowerCase()} tasks`}
                action={
                  <button
                    type="button"
                    className="btn"
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      setQ("");
                      setFilter("All");
                    }}
                  >
                    Clear filters
                  </button>
                }
              >
                {filter === "Active" ? "Nothing is running right now." : "Try another filter or search term."}
              </EmptyState>
            </div>
          ) : isMobile ? (
            <div className="card tight" style={{ marginBottom: 40, padding: "0 14px" }}>
              {list.map((t) => (
                <Link key={t.id} href={ROUTES.task(t.id)} className="lane tr-click" style={{ color: "inherit", alignItems: "flex-start" }}>
                  <Avatar name={t.agent?.name ?? t.title} hue={t.agent?.hue} size="sm" />
                  <div className="sp" style={{ minWidth: 0 }}>
                    <b className="small" style={{ display: "block" }}>
                      {t.title}
                    </b>
                    <div className="tiny muted">
                      {t.agent?.name ?? "Agent team"} · {dayLabel(t.createdAt)} · {t.isTest ? "free test" : eur(t.costCents)}
                    </div>
                    <TaskMarks t={t} meId={user?.id} />
                    {isActive(t) && (
                      <div className="progress" style={{ marginTop: 8, height: 5 }}>
                        <i style={{ width: `${Math.max(6, progressOf(t))}%` }} />
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", display: "grid", gap: 6, justifyItems: "end" }}>
                    <StatusTag status={t.status} label={isActive(t) ? "Active" : undefined} />
                    {t.outcome && <OutcomeTag outcome={t.outcome} />}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="tw" style={{ marginBottom: 40 }}>
              <table style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Cost</th>
                    <th>Execution</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => (
                    <tr key={t.id} className="tr-click" onClick={() => router.push(ROUTES.task(t.id))}>
                      <td style={{ whiteSpace: "normal", minWidth: 260 }}>
                        <Link href={ROUTES.task(t.id)} onClick={(e) => e.stopPropagation()} style={{ color: "inherit" }}>
                          <b>{t.title}</b>
                        </Link>
                        <div className="tiny muted">{t.agent?.name ?? "Agent team"}</div>
                        <TaskMarks t={t} meId={user?.id} />
                        {isActive(t) && (
                          <div className="progress" style={{ marginTop: 6, height: 4, maxWidth: 220 }}>
                            <i style={{ width: `${Math.max(6, progressOf(t))}%` }} />
                          </div>
                        )}
                      </td>
                      <td>{t.category ?? "—"}</td>
                      <td>
                        <StatusTag status={t.status} label={isActive(t) ? "Active" : undefined} />
                      </td>
                      <td>{dayLabel(t.createdAt)}</td>
                      <td>
                        {t.isTest ? <span className="muted">Free</span> : eur(t.costCents)}
                        {!t.isTest && (t.status === "FAILED" || t.status === "REFUNDED") && t.costCents > 0 && <div className="tiny muted">refunded</div>}
                      </td>
                      <td>{execTime(t)}</td>
                      <td>
                        <OutcomeTag outcome={t.outcome} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
