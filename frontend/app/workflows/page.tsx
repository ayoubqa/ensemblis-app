"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Avatar, EmptyState, Icon, Modal, PageSkeleton, RequireAuth, SkeletonCard, Tag, useToast } from "@/components";
import { api, type Agent, type Depth, type Frequency, type Task, type Workflow } from "@/lib/api";
import { toastApiError } from "@/lib/errors";
import { useAuth } from "@/lib/auth-context";
import { FREQ_PER } from "@/lib/data";
import { dayLabel, eur, longDate, plural } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { untilLabel } from "../dashboard/_lib/insights";

export default function WorkflowsPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<PageSkeleton />}>
        <Workflows />
      </Suspense>
    </RequireAuth>
  );
}

const FREQS: Frequency[] = ["Weekly", "Monthly", "Quarterly"];
const DEPTHS: { id: Depth; label: string }[] = [
  { id: "focused", label: "Focused — quick and lean" },
  { id: "standard", label: "Standard — balanced" },
  { id: "deep", label: "Deep — most thorough" },
];

function Workflows() {
  const { setUser } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const fromId = params.get("from");

  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [agents, setAgents] = useState<Map<string, Agent>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [prefill, setPrefill] = useState<Task | null>(null);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [deleting, setDeleting] = useState<Workflow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTask, setLastTask] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const [w, t, a] = await Promise.all([
        api.listWorkflows(),
        api.listTasks().catch(() => ({ tasks: [] as Task[] })),
        api.listAgents().catch(() => ({ agents: [] as Agent[], categories: [] })),
      ]);
      setWorkflows(w.workflows);
      setTasks(t.tasks);
      setAgents(new Map(a.agents.map((x) => [x.id, x])));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // ?from=<taskId> → open the create modal prefilled from that task.
  useEffect(() => {
    if (!fromId) return;
    let cancelled = false;
    api
      .getTask(fromId)
      .then(({ task }) => {
        if (cancelled) return;
        setPrefill(task);
        setCreateOpen(true);
      })
      .catch((e) => {
        if (!cancelled) toast.error(`Couldn't load that task: ${(e as Error).message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [fromId]);

  const closeCreate = () => {
    setCreateOpen(false);
    setPrefill(null);
    if (fromId) router.replace(ROUTES.workflows, { scroll: false });
  };

  const patch = async (w: Workflow, body: Parameters<typeof api.updateWorkflow>[1], msg?: string) => {
    setBusy(w.id + ":patch");
    try {
      const { workflow } = await api.updateWorkflow(w.id, body);
      setWorkflows((prev) => prev?.map((x) => (x.id === w.id ? workflow : x)) ?? prev);
      if (msg) toast(msg);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const run = async (w: Workflow) => {
    setBusy(w.id + ":run");
    try {
      const { task, user } = await api.runWorkflow(w.id);
      setUser(user);
      setLastTask((m) => ({ ...m, [w.id]: task.id }));
      setWorkflows((prev) => prev?.map((x) => (x.id === w.id ? { ...x, runCount: x.runCount + 1, lastRun: new Date().toISOString() } : x)) ?? prev);
      toast(`${w.name} is running · ${eur(task.costCents)}`, { action: { label: "View task", onClick: () => router.push(ROUTES.task(task.id)) } });
      // Refresh to pick up the server's rescheduled nextRun.
      api.listWorkflows().then((r) => setWorkflows(r.workflows)).catch(() => {});
    } catch (e) {
      toastApiError(toast, e, "Couldn't run this workflow");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const w = deleting;
    setBusy(w.id + ":del");
    try {
      await api.deleteWorkflow(w.id);
      setWorkflows((prev) => prev?.filter((x) => x.id !== w.id) ?? prev);
      setDeleting(null);
      toast("Workflow deleted");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const activeCount = workflows?.filter((w) => w.isActive).length ?? 0;
  const nextUp = useMemo(
    () =>
      (workflows ?? [])
        .filter((w) => w.isActive && w.nextRun)
        .sort((a, b) => new Date(a.nextRun!).getTime() - new Date(b.nextRun!).getTime())[0],
    [workflows]
  );

  return (
    <div className="wrap" style={{ paddingBottom: 40 }}>
      <div className="pagehead row between wrapflex">
        <div>
          <h1>Workflows</h1>
          <p>Turn work you repeat into work that runs itself. You set the schedule. Ensemblis assembles the team each time.</p>
        </div>
        <button type="button" className="btn p" onClick={() => setCreateOpen(true)}>
          <Icon name="plus" />
          Create workflow
        </button>
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

      {workflows && workflows.length > 0 && (
        <p className="small muted" style={{ marginTop: -8, marginBottom: 16 }}>
          {plural(activeCount, "active workflow")}
          {workflows.length > activeCount ? ` · ${workflows.length - activeCount} paused` : ""}
          {nextUp ? ` · next up: ${nextUp.name}, ${untilLabel(nextUp.nextRun).toLowerCase()}` : ""}. Each run is charged like a normal task.
        </p>
      )}

      {workflows === null && !error ? (
        <div className="grid g2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : workflows && workflows.length === 0 ? (
        <EmptyState icon="redo" title="No workflows yet" action={{ label: "Create your first workflow", onClick: () => setCreateOpen(true), icon: "plus" }}>
          Competitor monitoring, monthly reporting, lead refreshes — schedule any task once and Ensemblis runs it weekly, monthly or quarterly.
        </EmptyState>
      ) : (
        <div className="grid g2">
          {(workflows ?? []).map((w) => {
            const agent = w.agentId ? agents.get(w.agentId) : undefined;
            const per = FREQ_PER[w.frequency];
            const tid = lastTask[w.id];
            return (
              <article className="card" key={w.id} aria-labelledby={`wf-${w.id}`}>
                <div className="row between wrapflex">
                  <h3 id={`wf-${w.id}`} className="serif" style={{ fontSize: 22, margin: 0 }}>
                    {w.name}
                  </h3>
                  <span className={w.isActive ? "tag ok" : "tag gray"}>{w.isActive ? "Active" : "Paused"}</span>
                </div>
                <div className="grid g2 keep2" style={{ gap: 10, margin: "14px 0" }}>
                  <div>
                    <label className="tiny muted" htmlFor={`freq-${w.id}`} style={{ display: "block" }}>
                      Frequency
                    </label>
                    <select
                      id={`freq-${w.id}`}
                      className="f"
                      style={{ padding: "7px 10px" }}
                      value={w.frequency}
                      disabled={busy === w.id + ":patch"}
                      onChange={(e) => patch(w, { frequency: e.target.value as Frequency }, `Now runs ${e.target.value.toLowerCase()}`)}
                    >
                      {FREQS.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="tiny muted">Estimated cost</div>
                    <b>{agent ? `~${eur(agent.pricePerTaskCents)}/${per}` : "Priced per run"}</b>
                  </div>
                  <div>
                    <div className="tiny muted">Last run</div>
                    <b>{w.lastRun ? dayLabel(w.lastRun) : "Not yet"}</b>
                  </div>
                  <div>
                    <div className="tiny muted">Next run</div>
                    <b title={w.nextRun ? longDate(w.nextRun) : undefined}>{w.isActive ? untilLabel(w.nextRun) : "Paused"}</b>
                  </div>
                </div>
                <div className="tiny muted" style={{ marginBottom: 6 }}>
                  Brief · {plural(w.runCount, "run")} so far · {w.depth} depth
                </div>
                <p className="small" style={{ marginBottom: 12, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={w.basedOnText}>
                  {w.basedOnText}
                </p>
                {agent && (
                  <div className="row" style={{ gap: 8, marginBottom: 14 }}>
                    <Avatar name={agent.name} hue={agent.hue} size="xs" />
                    <span className="tiny muted">
                      Led by{" "}
                      <Link href={ROUTES.agent(agent.slug)} style={{ color: "var(--ink)", fontWeight: 600 }}>
                        {agent.name}
                      </Link>
                    </span>
                  </div>
                )}
                {tid && (
                  <div className="notice" style={{ background: "var(--accent-soft)", color: "var(--accent)", marginBottom: 12 }}>
                    <Icon name="zap" />
                    <span className="sp">Run started.</span>
                    <Link href={ROUTES.task(tid)} style={{ fontWeight: 700, color: "inherit" }}>
                      View task →
                    </Link>
                  </div>
                )}
                <div className="row wrapflex">
                  <button type="button" className="btn p sm" onClick={() => run(w)} disabled={!!busy} aria-busy={busy === w.id + ":run"}>
                    <Icon name="play" />
                    Run now
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    aria-pressed={!w.isActive}
                    disabled={busy === w.id + ":patch"}
                    onClick={() => patch(w, { isActive: !w.isActive }, w.isActive ? "Workflow paused" : "Workflow resumed")}
                  >
                    <Icon name={w.isActive ? "pause" : "play"} />
                    {w.isActive ? "Pause" : "Resume"}
                  </button>
                  <button type="button" className="btn sm" onClick={() => setEditing(w)}>
                    <Icon name="edit" />
                    Edit
                  </button>
                  <button type="button" className="btn sm bad" onClick={() => setDeleting(w)}>
                    <Icon name="trash" />
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="card flat" style={{ marginTop: 28 }}>
        <b>How workflows run</b>
        <p className="small muted" style={{ marginTop: 4, maxWidth: "70ch" }}>
          On each scheduled date Ensemblis plans a fresh team from the brief, charges the task price from your credits and delivers a new report to{" "}
          <Link href={ROUTES.tasks} style={{ color: "var(--accent)", fontWeight: 600 }}>
            My work
          </Link>
          . Pause any time — nothing runs or gets charged while paused.
        </p>
      </div>

      <CreateWorkflowModal
        open={createOpen}
        onClose={closeCreate}
        tasks={tasks}
        prefill={prefill}
        onCreated={(w) => {
          setWorkflows((prev) => [w, ...(prev ?? [])]);
          closeCreate();
          toast("Workflow activated", { icon: "check" });
        }}
      />
      <EditWorkflowModal
        workflow={editing}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          if (!editing) return;
          if (await patch(editing, body, "Workflow updated")) setEditing(null);
        }}
        saving={!!editing && busy === editing.id + ":patch"}
      />
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Delete this workflow?">
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          “{deleting?.name}” will stop running. Past tasks and reports stay in My work. This can't be undone.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => setDeleting(null)} data-autofocus>
            Keep workflow
          </button>
          <button type="button" className="btn bad sp" onClick={remove} aria-busy={!!deleting && busy === deleting.id + ":del"} disabled={!!busy}>
            Delete workflow
          </button>
        </div>
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------- create modal (wfModalHtml)
const NEW_BRIEF = "__new__";

function CreateWorkflowModal({
  open,
  onClose,
  tasks,
  prefill,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  prefill: Task | null;
  onCreated: (w: Workflow) => void;
}) {
  const candidates = useMemo(() => {
    const done = tasks.filter((t) => t.status === "COMPLETED");
    if (prefill && !done.some((t) => t.id === prefill.id)) return [prefill, ...done];
    return done;
  }, [tasks, prefill]);

  const [base, setBase] = useState<string>(NEW_BRIEF);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [freq, setFreq] = useState<Frequency>("Monthly");
  const [depth, setDepth] = useState<Depth>("standard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const applyTask = (t: Task | undefined) => {
    if (!t) {
      setBase(NEW_BRIEF);
      setName("");
      setText("");
      setDepth("standard");
      return;
    }
    setBase(t.id);
    setName(`${t.title} (recurring)`.slice(0, 120));
    setText(t.description);
    setDepth(t.depth);
  };

  // Reset on open: prefer the ?from task, else the most recent completed task.
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setFreq("Monthly");
    applyTask(prefill ?? candidates[0]);
  }, [open, prefill]);

  const selected = candidates.find((t) => t.id === base);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr("Give the workflow a name.");
    if (text.trim().length < 3) return setErr("Describe what should run each time.");
    setErr(null);
    setBusy(true);
    try {
      const { workflow } = await api.createWorkflow({
        name: name.trim(),
        basedOnText: text.trim(),
        frequency: freq,
        depth,
        ...(selected?.agentId ? { agentId: selected.agentId } : {}),
      });
      onCreated(workflow);
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create workflow">
      <form onSubmit={submit}>
        <p className="muted small" style={{ margin: "4px 0 14px" }}>
          {candidates.length ? "Pick work you've already run and schedule it — or write a new brief." : "Write the brief once. Ensemblis runs it on your schedule."}
        </p>
        {candidates.length > 0 && (
          <>
            <label className="l" htmlFor="wfbase">
              Based on
            </label>
            <select id="wfbase" className="f" value={base} onChange={(e) => applyTask(candidates.find((t) => t.id === e.target.value))}>
              {candidates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
              <option value={NEW_BRIEF}>Write a new brief…</option>
            </select>
          </>
        )}
        <label className="l" htmlFor="wfname" style={{ marginTop: 12 }}>
          Name
        </label>
        <input id="wfname" className="f" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Monthly competitor watch" data-autofocus={base === NEW_BRIEF ? true : undefined} />
        <label className="l" htmlFor="wftext" style={{ marginTop: 12 }}>
          What should run each time
        </label>
        <textarea id="wftext" className="f" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={8000} placeholder="e.g. Track pricing and feature changes from our top 5 competitors and summarise what changed." />
        <div className="grid g2 keep2" style={{ gap: 10, marginTop: 12 }}>
          <div>
            <label className="l" htmlFor="wffreq">
              Frequency
            </label>
            <select id="wffreq" className="f" value={freq} onChange={(e) => setFreq(e.target.value as Frequency)}>
              {FREQS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="l" htmlFor="wfdepth">
              Depth
            </label>
            <select id="wfdepth" className="f" value={depth} onChange={(e) => setDepth(e.target.value as Depth)}>
              {DEPTHS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="hint">
          {selected ? `Last run cost ${eur(selected.costCents)} — expect about ${eur(selected.costCents)} per ${FREQ_PER[freq]}.` : "Each run is priced and charged like a normal task."} First run{" "}
          {freq === "Weekly" ? "in a week" : freq === "Monthly" ? "in a month" : "in three months"}, or use Run now.
        </p>
        {err && (
          <div className="err" role="alert">
            {err}
          </div>
        )}
        <div className="row" style={{ marginTop: 18 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn p sp" disabled={busy} aria-busy={busy}>
            Activate workflow
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------- edit modal
function EditWorkflowModal({
  workflow,
  onClose,
  onSave,
  saving,
}: {
  workflow: Workflow | null;
  onClose: () => void;
  onSave: (body: { name: string; frequency: Frequency; depth: Depth }) => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [freq, setFreq] = useState<Frequency>("Monthly");
  const [depth, setDepth] = useState<Depth>("standard");
  useEffect(() => {
    if (workflow) {
      setName(workflow.name);
      setFreq(workflow.frequency);
      setDepth(workflow.depth);
    }
  }, [workflow]);

  return (
    <Modal open={!!workflow} onClose={onClose} title="Edit workflow">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave({ name: name.trim(), frequency: freq, depth });
        }}
      >
        <label className="l" htmlFor="ewname" style={{ marginTop: 8 }}>
          Name
        </label>
        <input id="ewname" className="f" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-invalid={!name.trim()} data-autofocus />
        {!name.trim() && <div className="err">Name is required.</div>}
        <div className="grid g2 keep2" style={{ gap: 10, marginTop: 12 }}>
          <div>
            <label className="l" htmlFor="ewfreq">
              Frequency
            </label>
            <select id="ewfreq" className="f" value={freq} onChange={(e) => setFreq(e.target.value as Frequency)}>
              {FREQS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="l" htmlFor="ewdepth">
              Depth
            </label>
            <select id="ewdepth" className="f" value={depth} onChange={(e) => setDepth(e.target.value as Depth)}>
              {DEPTHS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {workflow && (
          <div style={{ marginTop: 12 }}>
            <Tag variant="gray" icon="file">
              Brief
            </Tag>
            <p className="small muted" style={{ marginTop: 6, maxHeight: 120, overflow: "auto" }}>
              {workflow.basedOnText}
            </p>
          </div>
        )}
        <div className="row" style={{ marginTop: 18 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn p sp" disabled={saving || !name.trim()} aria-busy={saving}>
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}
