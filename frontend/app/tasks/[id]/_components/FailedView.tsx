"use client";

import Link from "next/link";
import { useState } from "react";
import { api, ApiError, type Task } from "@/lib/api";
import { isLimitError, toastApiError } from "@/lib/errors";
import { Icon, Modal, StepStatusTag, useToast } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { dateTime, eur } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { Md } from "./Md";
import { sortedSteps } from "./shared";

export function FailedView({ task, onTask }: { task: Task; onTask: (t: Task) => void }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [short, setShort] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const steps = sortedSteps(task);
  const done = steps.filter((x) => x.status === "COMPLETED");
  const failedStep = steps.find((x) => x.status === "FAILED");
  const refunded = task.costCents > 0;
  const canRetry = task.status === "FAILED";
  const balance = user?.credits ?? 0;
  const insufficient = balance < task.costCents;
  const replanHref = `${ROUTES.newTask}?q=${encodeURIComponent(task.description)}&depth=${task.depth}`;

  const retry = async () => {
    setBusy(true);
    setShort(null);
    try {
      const r = await api.retryTask(task.id);
      setUser(r.user);
      setConfirm(false);
      onTask(r.task);
      toast("Retry started with a fresh team");
      window.scrollTo({ top: 0 });
    } catch (e) {
      const ae = e as ApiError;
      if (ae.status === 402) setShort(ae.message);
      else {
        if (isLimitError(ae)) setConfirm(false);
        toastApiError(toast, ae, "Couldn't retry this task");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow">
      <div style={{ paddingTop: 28 }}>
        <span className="tag bad">{task.status === "REFUNDED" ? "Refunded" : "Task failed"}</span>
        <h1 className="serif" style={{ fontSize: "clamp(30px,5vw,40px)", margin: "12px 0 6px", lineHeight: 1.1 }}>
          This task did not complete.
        </h1>
        <p className="muted">
          {task.title}
          {task.agent ? ` · ${task.agent.name}` : ""} · {eur(task.costCents)}
        </p>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <b className="small">What happened</b>
        <div className="notice" style={{ margin: "10px 0 6px", background: "var(--bad-soft)", color: "var(--bad)" }}>
          <Icon name="alert" />
          <span style={{ wordBreak: "break-word" }}>
            {task.errorMessage || "The agent team stopped before producing the final deliverable."}
          </span>
        </div>
        {steps.map((st) => (
          <div className="kv" key={st.id}>
            <span style={{ color: "var(--ink)" }}>
              {st.order + 1}. {st.agentName} <span className="muted">· {st.title}</span>
            </span>
            <StepStatusTag status={st.status} />
          </div>
        ))}
        <p className="small muted" style={{ marginTop: 8 }}>
          {done.length} of {steps.length} steps completed
          {failedStep ? ` before ${failedStep.agentName} failed` : ""}. Failures are usually temporary: a model timeout or an empty response.
        </p>
      </div>

      {refunded && (
        <div className="notice" style={{ marginTop: 14, background: "var(--ok-soft)", color: "var(--ok)" }}>
          <Icon name="check" />
          <span>
            <b>{eur(task.costCents)} refunded</b> to your demo credits automatically
            {task.completedAt ? ` on ${dateTime(task.completedAt)}` : ""}. You weren&apos;t charged for this run.
          </span>
        </div>
      )}

      <div className="grid g3" style={{ marginTop: 16 }}>
        {canRetry ? (
          <button type="button" className="card opt" style={{ textAlign: "left" }} onClick={() => setConfirm(true)}>
            <b>
              <Icon name="redo" /> Retry
            </b>
            <p className="small muted">Run again with a fresh team. Charges {eur(task.costCents)} again; refunded again if it fails.</p>
          </button>
        ) : (
          <Link className="card opt" style={{ textAlign: "left" }} href={replanHref}>
            <b>
              <Icon name="redo" /> Start over
            </b>
            <p className="small muted">Re-plan this brief as a new task.</p>
          </Link>
        )}
        <Link className="card opt" style={{ textAlign: "left" }} href={replanHref}>
          <b>
            <Icon name="compass" /> Choose another agent
          </b>
          <p className="small muted">Re-plan this brief and switch the lead to a top alternative.</p>
        </Link>
        <Link className="card opt" style={{ textAlign: "left" }} href={ROUTES.billing}>
          <b>
            <Icon name="wallet" /> See your refund
          </b>
          <p className="small muted">{refunded ? `${eur(task.costCents)} returned to your wallet.` : "Review your credits and history."}</p>
        </Link>
      </div>

      {done.some((x) => x.output) && (
        <div className="card" style={{ marginTop: 16 }}>
          <b className="small">Partial work</b>
          <p className="small muted" style={{ marginTop: 4 }}>
            These steps finished before the failure. Their output is yours to read.
          </p>
          {done
            .filter((x) => x.output)
            .map((st) => (
              <div key={st.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="btn sm ghost"
                  aria-expanded={open === st.id}
                  onClick={() => setOpen(open === st.id ? null : st.id)}
                >
                  <Icon name={open === st.id ? "up" : "down"} />
                  {st.agentName} · {st.role}
                </button>
                {open === st.id && st.output && (
                  <div
                    className="reveal"
                    style={{ marginTop: 8, maxHeight: 420, overflow: "auto", padding: "4px 16px", borderRadius: 10, background: "var(--surface2)" }}
                  >
                    <Md small>{st.output}</Md>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      <div className="row" style={{ margin: "22px 0 8px" }}>
        <Link className="btn ghost" href={ROUTES.tasks}>
          <Icon name="back" />
          Back to My work
        </Link>
      </div>

      <Modal open={confirm} onClose={() => !busy && setConfirm(false)} title="Retry this task?" dismissible={!busy}>
        <p className="muted" style={{ margin: "2px 0 14px" }}>
          {task.title}
        </p>
        <div className="kv">
          <span>Cost</span>
          <b>{eur(task.costCents)} demo credits</b>
        </div>
        <div className="kv">
          <span>Remaining balance</span>
          <b style={insufficient ? { color: "var(--bad)" } : undefined}>
            {eur(balance)} → {eur(balance - task.costCents)}
          </b>
        </div>
        <div className="notice" style={{ margin: "14px 0", background: "var(--accent-soft)", color: "var(--accent)" }}>
          <Icon name="shield" />
          <span>Your earlier payment was already refunded. If this run fails too, it&apos;s refunded automatically.</span>
        </div>
        {(insufficient || short) && (
          <div className="notice" style={{ marginBottom: 14 }}>
            <Icon name="wallet" />
            <span>
              {short ?? `You need ${eur(task.costCents)} but have ${eur(balance)}.`}{" "}
              <Link href={ROUTES.billing} style={{ fontWeight: 700, textDecoration: "underline" }}>
                Add demo credits
              </Link>
            </span>
          </div>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={() => setConfirm(false)} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn p lg sp" onClick={retry} disabled={busy || insufficient} aria-busy={busy} data-autofocus>
            Confirm &amp; retry
          </button>
        </div>
      </Modal>
    </div>
  );
}
