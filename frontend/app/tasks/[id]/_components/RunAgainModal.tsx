"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Task, type TaskEstimate } from "@/lib/api";
import { Icon, Modal, Skeleton, useToast } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { eur, minutesRange } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

/** Re-run a task as a new task with the same brief, depth and lead agent. */
export function RunAgainModal({ task, open, onClose }: { task: Task; open: boolean; onClose: () => void }) {
  const { user, setUser } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [est, setEst] = useState<TaskEstimate | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [short, setShort] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setErr(null);
    setShort(null);
    api
      .estimateTask({ description: task.description, depth: task.depth, agentId: task.agentId ?? undefined })
      .then(({ estimate }) => live && setEst(estimate))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [open, task.description, task.depth, task.agentId]);

  const cost = est?.costCents ?? task.costCents;
  const balance = user?.credits ?? 0;
  const insufficient = !!user && balance < cost;

  const go = async () => {
    setBusy(true);
    try {
      const r = await api.createTask({
        description: task.description,
        title: task.title,
        depth: task.depth,
        agentId: est?.leadAgent.id ?? task.agentId ?? undefined,
      });
      setUser(r.user);
      toast("Running it again. Your team is on it.");
      onClose();
      router.push(ROUTES.task(r.task.id));
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 402) setShort(ae.message);
      else toast.error(ae.message || "Couldn't start the task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Run this task again?" dismissible={!busy}>
      <p className="muted" style={{ margin: "2px 0 14px" }}>
        {task.title} — same brief, same depth, with a fresh run of the team. You&apos;ll get a new, separate report.
      </p>
      {err && (
        <div className="notice" style={{ marginBottom: 12, background: "var(--bad-soft)", color: "var(--bad)" }}>
          <Icon name="alert" />
          <span>{err}</span>
        </div>
      )}
      <div className="kv">
        <span>Cost</span>
        <b>{est || err ? `${eur(cost)} demo credits` : <Skeleton width={90} height={14} />}</b>
      </div>
      <div className="kv">
        <span>Estimated completion</span>
        <b>{est ? minutesRange(est.estMinutesLow, est.estMinutesHigh) : err ? "—" : <Skeleton width={70} height={14} />}</b>
      </div>
      <div className="kv">
        <span>Remaining balance</span>
        <b style={insufficient ? { color: "var(--bad)" } : undefined}>
          {eur(balance)} → {eur(balance - cost)}
        </b>
      </div>
      {(insufficient || short) && (
        <div className="notice" style={{ margin: "14px 0 0" }}>
          <Icon name="wallet" />
          <span>
            {short ?? `This run costs ${eur(cost)}, but you have ${eur(balance)} left.`}{" "}
            <Link href={ROUTES.billing} style={{ fontWeight: 700, textDecoration: "underline" }}>
              Add demo credits
            </Link>
          </span>
        </div>
      )}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn p lg sp"
          onClick={go}
          disabled={busy || (!est && !err) || insufficient}
          aria-busy={busy}
          data-autofocus
        >
          <Icon name="redo" />
          Confirm &amp; run again
        </button>
      </div>
    </Modal>
  );
}
