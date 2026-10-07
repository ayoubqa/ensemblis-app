"use client";

import { useEffect, useId, useState } from "react";
import { api, type Task } from "@/lib/api";
import { Icon, Modal, useToast } from "@/components";
import { copyText } from "@/components/report";
import { toastApiError } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import R from "./refine.module.css";

/** Turn the public read-only link on/off and copy it. */
export function ShareModal({ task, open, onClose, onTask }: { task: Task; open: boolean; onClose: () => void; onTask: (t: Task) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const linkId = useId();
  const on = !!task.shareToken;
  const url = task.shareToken ? `${origin}${ROUTES.sharedReport(task.shareToken)}` : "";
  const versions = (task.revisions ?? []).filter((r) => r.status === "COMPLETED").length;

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      const r = await api.setShare(task.id, enabled);
      onTask(r.task);
      if (enabled) toast("Public link ready to share", { icon: "link" });
      else toast("Sharing stopped. The old link no longer works.", { icon: "lock" });
    } catch (e) {
      toastApiError(toast, e, enabled ? "Couldn't create the link" : "Couldn't stop sharing");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    if (await copyText(url)) {
      setCopied(true);
      toast.info("Link copied", { icon: "copy" });
    } else toast.error("Couldn't copy. Select the link and copy it manually.");
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Share this report" dismissible={!busy}>
      <p className="muted small">Send a clean, read-only copy to a colleague or client. They don&apos;t need an account.</p>

      <div className={R.switchRow}>
        <div style={{ minWidth: 0 }}>
          <b id={`${linkId}-label`}>Public link</b>
          <div className="tiny muted">{on ? "On: anyone with the link can read it" : "Off: only you can see this report"}</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={`${linkId}-label`}
          aria-busy={busy}
          className={R.switch}
          disabled={busy}
          onClick={() => toggle(!on)}
          data-autofocus
        >
          <i />
        </button>
      </div>

      {on ? (
        <>
          <label className="l" htmlFor={linkId}>
            Link to share
          </label>
          <div className={R.linkRow}>
            <input id={linkId} className="f" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-describedby={`${linkId}-note`} />
            <button type="button" className="btn p" onClick={copy}>
              <Icon name={copied ? "check" : "copy"} />
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <div className="row wrapflex" style={{ marginTop: 8, gap: 8 }}>
            <a className="btn sm ghost" href={url} target="_blank" rel="noopener noreferrer">
              <Icon name="ext" />
              Open the shared page
            </a>
          </div>
        </>
      ) : (
        <button type="button" className="btn p block" onClick={() => toggle(true)} disabled={busy} aria-busy={busy}>
          <Icon name="link" />
          Create public link
        </button>
      )}

      <div id={`${linkId}-note`} className="notice" style={{ marginTop: 16, background: "var(--accent-soft)", color: "var(--accent)" }}>
        <Icon name="lock" />
        <span>Anyone with the link can read this report (not your account or other tasks).</span>
      </div>
      <p className="tiny muted" style={{ marginTop: 10 }}>
        The page shows the {versions > 1 ? "latest version of the " : ""}report and its numbered sources (files you attached are listed by name only, though the
        report text may quote them), never your account, balance or other tasks. Turning the link off breaks it immediately.
      </p>

      <div className="row between wrapflex" style={{ marginTop: 16, gap: 10 }}>
        {on ? (
          <button type="button" className="btn bad" onClick={() => toggle(false)} disabled={busy} aria-busy={busy}>
            <Icon name="x" />
            Stop sharing
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Done
        </button>
      </div>
    </Modal>
  );
}
