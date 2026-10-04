"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Avatar,
  CountUp,
  Icon,
  Kbd,
  LineChart,
  OutcomeTag,
  ProgressBar,
  RequireAuth,
  Skeleton,
  SkeletonText,
  Stat,
  StatusTag,
  Tag,
  confetti,
  useToast,
} from "@/components";
import { api, type Agent, type Billing, type Task, type Workflow } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { EXAMPLES, EX_FULL, ONBOARDING_STEPS } from "@/lib/data";
import { dayLabel, eur, firstName, greeting, plural } from "@/lib/format";
import { useKeyboardShortcut, useLocalStorage, usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { currentStep, isActive, spendSeries, startOfMonth, taskProgress, untilLabel } from "./_lib/insights";

export default function DashboardPage() {
  return (
    <RequireAuth>
      <Dashboard />
    </RequireAuth>
  );
}

function Dashboard() {
  const { user, setUser, refresh } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [workforce, setWorkforce] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runningWf, setRunningWf] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<"14 days" | "12 weeks">("14 days");
  const [onbDismissed, setOnbDismissed] = useLocalStorage<boolean>(`ens.onb.dismissed.${user?.id ?? "anon"}`, false);
  const prevStatus = useRef<Map<string, Task["status"]>>(new Map());

  const remember = (list: Task[]) => {
    prevStatus.current = new Map(list.map((t) => [t.id, t.status]));
  };

  const load = useCallback(async () => {
    setError(null);
    const [t, b, w, f] = await Promise.allSettled([api.listTasks(), api.billing(), api.listWorkflows(), api.listWorkforce()]);
    if (t.status === "fulfilled") {
      setTasks(t.value.tasks);
      remember(t.value.tasks);
    } else setError(t.reason?.message ?? "Couldn't load your tasks.");
    if (b.status === "fulfilled") setBilling(b.value);
    if (w.status === "fulfilled") setWorkflows(w.value.workflows);
    else setWorkflows([]);
    if (f.status === "fulfilled") setWorkforce(f.value.agents);
    else setWorkforce([]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasActive = !!tasks?.some(isActive);

  // Live progress: poll while anything is planning/running.
  usePolling(
    async () => {
      const { tasks: next } = await api.listTasks();
      let moneyMoved = false;
      for (const t of next) {
        const before = prevStatus.current.get(t.id);
        if (!before || !isActive({ status: before })) continue;
        if (t.status === "COMPLETED") {
          confetti();
          toast(`“${t.title}” is ready`, { action: { label: "Open", onClick: () => router.push(ROUTES.task(t.id)) } });
          moneyMoved = true;
        } else if (t.status === "FAILED" || t.status === "REFUNDED") {
          toast.error(`“${t.title}” didn't finish${t.status === "REFUNDED" ? " — credits refunded" : ""}`);
          moneyMoved = true;
        }
      }
      setTasks(next);
      remember(next);
      if (moneyMoved) {
        refresh();
        api.billing().then(setBilling).catch(() => {});
      }
      return next.some(isActive);
    },
    3000,
    { enabled: hasActive, immediate: false }
  );

  const runWorkflow = async (w: Workflow) => {
    setRunningWf(w.id);
    try {
      const { task, user: u } = await api.runWorkflow(w.id);
      setUser(u);
      setTasks((prev) => {
        const list = [task, ...(prev ?? []).filter((x) => x.id !== task.id)];
        remember(list);
        return list;
      });
      setWorkflows((prev) => prev?.map((x) => (x.id === w.id ? { ...x, runCount: x.runCount + 1, lastRun: new Date().toISOString() } : x)) ?? prev);
      api.billing().then(setBilling).catch(() => {});
      toast(`${w.name} started`, { action: { label: "View", onClick: () => router.push(ROUTES.task(task.id)) } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRunningWf(null);
    }
  };

  // ------------------------------------------------------------- derived
  const stats = useMemo(() => {
    if (!tasks) return null;
    const m0 = startOfMonth().getTime();
    const prevM0 = startOfMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)).getTime();
    const thisMonth = tasks.filter((t) => new Date(t.createdAt).getTime() >= m0).length;
    const lastMonth = tasks.filter((t) => {
      const c = new Date(t.createdAt).getTime();
      return c >= prevM0 && c < m0;
    }).length;
    const rated = tasks.filter((t) => t.outcome);
    const achieved = rated.filter((t) => t.outcome === "Achieved").length;
    const completed = tasks.filter((t) => t.status === "COMPLETED");
    const unrated = completed.filter((t) => !t.outcome);
    return {
      thisMonth,
      lastMonth,
      rated: rated.length,
      achievedRate: rated.length ? Math.round((achieved / rated.length) * 100) : null,
      completed,
      unrated,
    };
  }, [tasks]);

  const active = useMemo(() => (tasks ?? []).filter(isActive), [tasks]);
  const recent = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => !isActive(t))
        .sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime() - new Date(a.completedAt ?? a.createdAt).getTime())
        .slice(0, 4),
    [tasks]
  );
  const upcoming = useMemo(
    () =>
      (workflows ?? [])
        .slice()
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || new Date(a.nextRun ?? 0).getTime() - new Date(b.nextRun ?? 0).getTime())
        .slice(0, 3),
    [workflows]
  );
  const series = useMemo(
    () => (billing ? spendSeries(billing.transactions, chartMode === "14 days" ? "day" : "week", chartMode === "14 days" ? 14 : 12) : null),
    [billing, chartMode]
  );

  if (!user) return null;
  const loading = tasks === null && !error;
  const isNew = tasks !== null && tasks.length === 0;
  const onb = {
    described: !!tasks?.length,
    reviewed: !!tasks?.some((t) => t.steps.length > 0),
    result: !!stats?.completed.length,
  };
  const showOnb = tasks !== null && !onbDismissed && !(onb.described && onb.reviewed && onb.result);

  return (
    <div className="wrap" style={{ paddingBottom: 40 }}>
      <div className="pagehead row between wrapflex" style={{ alignItems: "flex-end" }}>
        <div>
          <h1>
            {greeting()}, {firstName(user.name)}.
          </h1>
          <p>
            {loading
              ? "Pulling together your workspace…"
              : hasActive
                ? `${plural(active.length, "task")} in progress right now. Progress updates live.`
                : isNew
                  ? "Your workspace is ready. Describe an outcome and Ensemblis assembles the team."
                  : "Here's what your AI workforce has been up to."}
          </p>
        </div>
        <Link href={ROUTES.billing} className="credpill" title="Payments and demo credits">
          <Icon name="eur" />
          {eur(user.credits)} demo credits
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

      {showOnb && (
        <div className="card reveal" style={{ marginBottom: 18, borderColor: "var(--accent)" }}>
          <div className="row between" style={{ marginBottom: 4 }}>
            <b style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 500 }}>Get to your first result in 3 steps</b>
            <button type="button" className="btn sm" onClick={() => setOnbDismissed(true)}>
              Dismiss
            </button>
          </div>
          {ONBOARDING_STEPS.map(([tt, dd], i) => {
            const done = [onb.described, onb.reviewed, onb.result][i];
            return (
              <div key={tt} className={done ? "onb done" : "onb"}>
                <span className="ic">
                  <Icon name="check" />
                </span>
                <div>
                  <b className="small">{tt}</b>
                  <span className="sr-only">{done ? " (done)" : ""}</span>
                  <div className="tiny muted">{dd}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <QuickBrief autoFocus={isNew} />

      {/* KPI row */}
      <div className="grid g4 keep2" style={{ marginTop: 22 }}>
        {loading || !stats ? (
          [0, 1, 2, 3].map((i) => (
            <div key={i} className="stat">
              <Skeleton width="50%" height={26} />
              <Skeleton width="70%" height={11} style={{ marginTop: 8 }} />
            </div>
          ))
        ) : (
          <>
            <Stat
              value={<CountUp to={stats.thisMonth} />}
              label="tasks this month"
              delta={stats.thisMonth > stats.lastMonth && stats.lastMonth > 0 ? `+${stats.thisMonth - stats.lastMonth} vs last month` : undefined}
            />
            <Stat value={billing ? eur(billing.monthSpendCents) : "—"} label="spent this month" />
            <Stat value={eur(user.credits)} label="demo credits left" />
            <Stat
              value={stats.achievedRate === null ? "—" : <CountUp to={stats.achievedRate} suffix="%" />}
              label={stats.achievedRate === null ? "achieved · rate a result" : `achieved · ${plural(stats.rated, "rated task")}`}
            />
          </>
        )}
      </div>

      <div className="grid" id="dg2" style={{ gridTemplateColumns: "1.6fr 1fr", gap: 16, marginTop: 22, alignItems: "start" }}>
        {/* ------------------------------------------------ left column */}
        <div className="stack">
          <section className="card" aria-labelledby="h-active">
            <div className="row between">
              <div className="eyebrow" id="h-active" style={{ margin: 0 }}>
                ACTIVE WORK
              </div>
              {hasActive && (
                <span className="tiny muted row" style={{ gap: 6 }}>
                  <span className="pulse" aria-hidden="true" />
                  Live
                </span>
              )}
            </div>
            {loading ? (
              <div style={{ marginTop: 12 }}>
                <SkeletonText lines={3} />
              </div>
            ) : active.length ? (
              <div aria-live="polite">
                {active.map((t) => {
                  const step = currentStep(t);
                  const done = t.steps.filter((s) => s.status === "COMPLETED").length;
                  const prog = taskProgress(t);
                  return (
                    <div className="lane" key={t.id}>
                      <div className="sp" style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 8 }}>
                          <b className="small">{t.title}</b>
                          <StatusTag status={t.status} />
                        </div>
                        <div className="tiny muted" style={{ marginTop: 2 }}>
                          {t.agent?.name ?? "Assembling team"} · {eur(t.costCents)}
                          {t.steps.length ? ` · step ${Math.min(done + 1, t.steps.length)} of ${t.steps.length}` : ""}
                          {step ? ` — ${step.title}` : ""}
                        </div>
                        <ProgressBar value={prog} label={`${t.title} progress`} style={{ marginTop: 8 }} />
                      </div>
                      <Link className="btn sm" href={ROUTES.task(t.id)}>
                        View progress
                      </Link>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="small muted" style={{ marginTop: 8 }}>
                Nothing is running. Start a new task and it will appear here with live progress.
              </p>
            )}
          </section>

          <section className="card" aria-labelledby="h-recent">
            <div className="row between">
              <div className="eyebrow" id="h-recent" style={{ margin: 0 }}>
                RECENT RESULTS
              </div>
              <Link className="btn sm" href={ROUTES.tasks}>
                View all
              </Link>
            </div>
            {loading ? (
              <div style={{ marginTop: 12 }}>
                <SkeletonText lines={4} />
              </div>
            ) : recent.length ? (
              recent.map((t) => (
                <Link key={t.id} href={ROUTES.task(t.id)} className="lane tr-click" style={{ color: "inherit" }}>
                  <div className="sp" style={{ minWidth: 0 }}>
                    <b className="small">{t.title}</b>
                    <div className="tiny muted">
                      {t.status === "COMPLETED" ? `Completed ${dayLabel(t.completedAt ?? t.createdAt)}` : `${t.status === "REFUNDED" ? "Refunded" : "Failed"} ${dayLabel(t.completedAt ?? t.createdAt)}`}
                      {t.agent ? ` · ${t.agent.name}` : ""}
                    </div>
                  </div>
                  {t.status === "COMPLETED" ? (
                    t.outcome ? (
                      <OutcomeTag outcome={t.outcome} />
                    ) : (
                      <span className="tag gray hideS">Rate it</span>
                    )
                  ) : (
                    <StatusTag status={t.status} />
                  )}
                  <b className="small">{eur(t.costCents)}</b>
                  <Icon name="chev" />
                </Link>
              ))
            ) : (
              <div style={{ marginTop: 10 }}>
                <p className="small muted">Finished deliverables land here — reports, lead lists, analyses. Try one of these to see how it works:</p>
                <div className="examples" style={{ marginTop: 10 }}>
                  {EXAMPLES.slice(0, 4).map((ex) => (
                    <Link key={ex} className="chip" href={`${ROUTES.newTask}?q=${encodeURIComponent(EX_FULL[ex] ?? ex)}`}>
                      {ex}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </section>

          <Tips
            credits={user.credits}
            unrated={stats?.unrated ?? []}
            completedCount={stats?.completed.length ?? 0}
            workflowCount={workflows?.length ?? 0}
            workforceCount={workforce?.length ?? 0}
            isNew={isNew}
          />
        </div>

        {/* ------------------------------------------------ right column */}
        <div className="stack">
          <section className="card" aria-labelledby="h-wf">
            <div className="row between">
              <div className="eyebrow" id="h-wf" style={{ margin: 0 }}>
                UPCOMING RUNS
              </div>
              <Link className="btn sm" href={ROUTES.workflows}>
                Manage
              </Link>
            </div>
            {workflows === null ? (
              <div style={{ marginTop: 12 }}>
                <SkeletonText lines={2} />
              </div>
            ) : upcoming.length ? (
              upcoming.map((w) => (
                <div className="lane" key={w.id}>
                  <div className="sp" style={{ minWidth: 0 }}>
                    <b className="small">{w.name}</b>
                    <div className="tiny muted">
                      {w.frequency} · {w.isActive ? `next ${untilLabel(w.nextRun)}` : "Paused"}
                    </div>
                  </div>
                  <button type="button" className="btn sm" onClick={() => runWorkflow(w)} disabled={!!runningWf} aria-busy={runningWf === w.id}>
                    Run now
                  </button>
                </div>
              ))
            ) : (
              <p className="small muted" style={{ marginTop: 8 }}>
                Work you repeat can run itself.{" "}
                <Link href={ROUTES.workflows} style={{ color: "var(--accent)", fontWeight: 600 }}>
                  Create a workflow
                </Link>{" "}
                from any finished task.
              </p>
            )}
          </section>

          <section className="card" aria-labelledby="h-spend">
            <div className="row between">
              <div className="eyebrow" id="h-spend" style={{ margin: 0 }}>
                SPENDING
              </div>
              <div className="row" style={{ gap: 4 }}>
                {(["14 days", "12 weeks"] as const).map((m) => (
                  <button key={m} type="button" className={m === chartMode ? "chip on" : "chip"} style={{ padding: "2px 9px", fontSize: 12 }} aria-pressed={m === chartMode} onClick={() => setChartMode(m)}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {billing && series ? (
              <>
                <b style={{ fontSize: 34, letterSpacing: "-.02em", display: "block", marginTop: 8 }}>{eur(billing.monthSpendCents)}</b>
                <div className="small muted">This month, in demo credits · {eur(billing.lifetimeSpendCents)} all time</div>
                <div style={{ marginTop: 8 }}>
                  <LineChart values={series.values.map((v) => v / 100)} xLabels={series.labels} height={100} label={`Spending over the last ${chartMode}`} format={(v) => eur(Math.round(v * 100))} />
                </div>
              </>
            ) : (
              <div style={{ marginTop: 12 }}>
                <Skeleton width="40%" height={30} />
                <Skeleton height={90} style={{ marginTop: 12 }} />
              </div>
            )}
            <Link className="btn sm" style={{ marginTop: 10 }} href={ROUTES.billing}>
              View payments
            </Link>
          </section>

          <section className="card" aria-labelledby="h-wfc">
            <div className="row between">
              <div className="eyebrow" id="h-wfc" style={{ margin: 0 }}>
                YOUR WORKFORCE
              </div>
              <Link className="btn sm" href={ROUTES.workforce}>
                {workforce?.length ? "Open" : "Build it"}
              </Link>
            </div>
            {workforce === null ? (
              <div style={{ marginTop: 12 }}>
                <SkeletonText lines={2} />
              </div>
            ) : workforce.length ? (
              workforce.slice(0, 4).map((a) => (
                <div className="lane" key={a.id}>
                  <Avatar name={a.name} hue={a.hue} size="sm" />
                  <div className="sp" style={{ minWidth: 0 }}>
                    <Link href={ROUTES.agent(a.slug)} className="small" style={{ fontWeight: 700, color: "inherit" }}>
                      {a.name}
                    </Link>
                    <div className="tiny muted">
                      {a.category} · typical {eur(a.pricePerTaskCents)}
                    </div>
                  </div>
                  <Link className="btn sm" href={`${ROUTES.newTask}?agent=${encodeURIComponent(a.slug)}`} aria-label={`Assign work to ${a.name}`}>
                    Assign
                  </Link>
                </div>
              ))
            ) : (
              <p className="small muted" style={{ marginTop: 8 }}>
                Save the agents that do great work for you and assign them new tasks in one click.{" "}
                <Link href={ROUTES.agents} style={{ color: "var(--accent)", fontWeight: 600 }}>
                  Explore agents
                </Link>
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- quick brief
function QuickBrief({ autoFocus }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const go = () => {
    const text = q.trim();
    router.push(text ? `${ROUTES.newTask}?q=${encodeURIComponent(text)}` : ROUTES.newTask);
  };
  useKeyboardShortcut("mod+enter", () => {
    if (document.activeElement === ref.current) go();
  }, { allowInInputs: true });
  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  return (
    <form
      className="brief"
      style={{ marginTop: 0 }}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <label htmlFor="dash-brief">What do you need done?</label>
      <textarea
        id="dash-brief"
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g. Research our top 5 competitors' pricing and summarise where we can win…"
        style={{ minHeight: 76 }}
        rows={2}
      />
      <div className="foot">
        <div className="row wrapflex sp" style={{ gap: 6 }}>
          {EXAMPLES.slice(0, 4).map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              style={{ padding: "3px 10px", fontSize: 12 }}
              onClick={() => {
                setQ(EX_FULL[ex] ?? ex);
                ref.current?.focus();
              }}
            >
              {ex}
            </button>
          ))}
        </div>
        <span className="tiny muted hideS">
          <Kbd>⌘</Kbd> <Kbd>Enter</Kbd>
        </span>
        <button type="submit" className="btn p">
          <Icon name="plus" />
          {q.trim() ? "Plan my team" : "New task"}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------- contextual tips
function Tips({
  credits,
  unrated,
  completedCount,
  workflowCount,
  workforceCount,
  isNew,
}: {
  credits: number;
  unrated: Task[];
  completedCount: number;
  workflowCount: number;
  workforceCount: number;
  isNew: boolean;
}) {
  const tips: { icon: Parameters<typeof Icon>[0]["name"]; title: string; body: string; href: string; cta: string }[] = [];
  if (isNew)
    tips.push({
      icon: "zap",
      title: "Run your first task",
      body: "Describe the outcome in plain words. You'll see the team, price and timing before anything is charged.",
      href: ROUTES.newTask,
      cta: "Start a task",
    });
  if (credits < 1500)
    tips.push({ icon: "wallet", title: "Credits running low", body: `You have ${eur(credits)} left. Top up demo credits — they're never charged.`, href: ROUTES.billing, cta: "Add credits" });
  if (unrated.length)
    tips.push({
      icon: "star",
      title: `Rate ${plural(unrated.length, "result")}`,
      body: "Telling us whether a result achieved its goal sharpens which agents Ensemblis picks for you.",
      href: ROUTES.task(unrated[0].id),
      cta: "Rate the latest",
    });
  if (completedCount > 0 && workflowCount === 0)
    tips.push({ icon: "redo", title: "Make it recurring", body: "Anything you'd ask for again — competitor watch, monthly reporting — can run on a schedule.", href: ROUTES.workflows, cta: "Create a workflow" });
  if (completedCount > 0 && workforceCount === 0)
    tips.push({ icon: "user", title: "Keep your best agents close", body: "Save agents that delivered to your workforce and assign them work directly.", href: ROUTES.workforce, cta: "See suggestions" });

  return (
    <section className="card flat" aria-label="Tips">
      {tips.length ? (
        <div className="stack" style={{ gap: 14 }}>
          {tips.slice(0, 2).map((t) => (
            <div key={t.title} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
              <span className="tag" style={{ padding: 6 }} aria-hidden="true">
                <Icon name={t.icon} />
              </span>
              <div className="sp">
                <b className="small">{t.title}</b>
                <p className="tiny muted" style={{ margin: "2px 0 8px", maxWidth: "60ch" }}>
                  {t.body}
                </p>
                <Link className="btn sm" href={t.href}>
                  {t.cta}
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="row wrapflex" style={{ gap: 10 }}>
          <Tag variant="gray" icon="keyboard">
            Tip
          </Tag>
          <span className="small muted">
            Press <Kbd>N</Kbd> for a new task, <Kbd>⌘</Kbd> <Kbd>K</Kbd> to jump anywhere, or <Kbd>G</Kbd> then <Kbd>B</Kbd> for payments.
          </span>
        </div>
      )}
    </section>
  );
}

