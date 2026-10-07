"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon, useToast } from "@/components";
import { useConfig } from "@/lib/config";
import { num } from "@/lib/format";
import { loginUrl, signupUrl } from "@/lib/routes";
import { cx } from "@/lib/utils";
import { ACCEPT } from "./extract";
import { FileBadge } from "./FileBadge";
import { formatBytes, type AttachmentItem, type AttachmentsApi, type LinkError } from "./useAttachments";
import s from "./attachments.module.css";

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

/**
 * While mounted, files dragged anywhere over the window light up the drop
 * zone, and a drop anywhere attaches them (instead of the browser opening the
 * file and leaving the page). With `enabled` false, drops are just swallowed.
 */
function useWindowFileDrop(enabled: boolean, onDrop: (files: FileList) => void, onBlocked?: () => void) {
  const [armed, setArmed] = useState(false);
  const cb = useRef({ onDrop, onBlocked, enabled });
  cb.current = { onDrop, onBlocked, enabled };
  useEffect(() => {
    let depth = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    // Browsers fire dragover continuously while a drag is over the page; if it
    // stops (drag cancelled with Esc, left through a gap), relax the highlight.
    const settle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => {
        depth = 0;
        setArmed(false);
      }, 800);
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setArmed(true);
      settle();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setArmed(false);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      settle();
      // "none" cancels the drop entirely (e.g. no free slots); a blocked handler still wants the drop to explain itself.
      if (e.dataTransfer) e.dataTransfer.dropEffect = cb.current.enabled || cb.current.onBlocked ? "copy" : "none";
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      clearTimeout(idle);
      depth = 0;
      setArmed(false);
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      if (cb.current.enabled) cb.current.onDrop(files);
      else cb.current.onBlocked?.();
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      clearTimeout(idle);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return armed;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function progressText(it: AttachmentItem): string {
  const p = it.progress;
  if (!p) return it.status === "uploading" ? "Uploading…" : "Reading…";
  if (p.total) return `${p.label}… ${p.done ?? 0}/${p.total} ${p.unit ?? ""}`.trim();
  return p.label;
}

function Row({ it, onRemove, onRetry }: { it: AttachmentItem; onRemove: () => void; onRetry: () => void }) {
  const working = it.status === "reading" || it.status === "uploading";
  const pct = working && it.progress?.total ? Math.round((100 * (it.progress.done ?? 0)) / it.progress.total) : null;
  const removeLabel = working ? `Cancel ${it.name}` : it.status === "error" ? `Dismiss ${it.name}` : `Remove ${it.name}`;
  return (
    <li className={cx(s.item, it.status === "error" && s.bad)}>
      <FileBadge kind={it.kind} />
      <div className={s.meta}>
        <div className={s.name} title={it.name}>
          {it.name}
        </div>
        <div className={s.sub}>
          {working ? (
            <span>{progressText(it)}</span>
          ) : it.status === "error" ? (
            <span className={s.badText}>{it.error}</span>
          ) : (
            <>
              <span className={s.okText}>
                <Icon name="check" size={13} strokeWidth={2.6} />
                {num(it.charCount)} characters
              </span>
              {it.kind === "url" && it.url && (
                <a href={it.url} target="_blank" rel="noopener noreferrer nofollow" title={it.url}>
                  {hostOf(it.url)}
                </a>
              )}
              {it.kind !== "url" && it.size !== null && <span>{formatBytes(it.size)}</span>}
              {it.note && <span>{it.note}</span>}
              {it.truncatedTo !== null && (
                <span className={s.warnTag} title="Only the beginning is used — the rest is left out to keep the task fast and affordable.">
                  Truncated to {num(it.truncatedTo)} characters
                </span>
              )}
            </>
          )}
        </div>
        {working && (
          <div
            className={cx(s.bar, pct === null && s.indet)}
            role="progressbar"
            aria-label={`${progressText(it)} ${it.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct ?? undefined}
          >
            <i style={pct !== null ? { width: `${Math.max(4, pct)}%` } : undefined} />
          </div>
        )}
      </div>
      <div className={s.actions}>
        {it.status === "error" && it.retryable && (
          <button type="button" className={s.iconBtn} onClick={onRetry} aria-label={`Try ${it.name} again`} title="Try again">
            <Icon name="redo" size={16} />
          </button>
        )}
        <button type="button" className={cx(s.iconBtn, s.danger)} onClick={onRemove} aria-label={removeLabel} title={working ? "Cancel" : "Remove"}>
          <Icon name={it.status === "ready" ? "trash" : "x"} size={16} />
        </button>
      </div>
    </li>
  );
}

/** Drop zone + "Add files" + "Add a link" + the attached rows. Signed-in, non-guest users only. */
export function AttachmentPanel({ att, max }: { att: AttachmentsApi; max: number }) {
  const { config } = useConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState<LinkError | null>(null);
  const full = att.used >= max;
  const armed = useWindowFileDrop(!full, (files) => {
    setOver(false);
    att.addFiles(files);
  });
  useEffect(() => {
    if (!armed) setOver(false); // drag ended or was cancelled
  }, [armed]);

  // Screen-reader announcements when a row settles.
  const [announce, setAnnounce] = useState("");
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    for (const it of att.items) {
      const prev = seen.current.get(it.key);
      if (prev && prev !== it.status) {
        if (it.status === "ready") setAnnounce(`${it.name} attached, ${num(it.charCount)} characters.`);
        else if (it.status === "error") setAnnounce(`${it.name}: ${it.error ?? "failed"}`);
      }
      seen.current.set(it.key, it.status);
    }
  }, [att.items]);

  const pick = () => {
    if (!full) inputRef.current?.click();
  };

  const submitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!link.trim() || linkBusy) return;
    setLinkBusy(true);
    setLinkErr(null);
    const err = await att.addLink(link);
    setLinkBusy(false);
    if (err) setLinkErr(err);
    else setLink("");
  };

  return (
    <section className={s.panel} aria-labelledby="att-title">
      <div className={s.head}>
        <div className="tiny muted" id="att-title">
          <b style={{ color: "var(--ink)" }}>Materials</b> · optional — documents and links your agents should read and cite
        </div>
        <span className={s.count}>
          {att.used}/{max}
          <span className="sr-only"> attached</span>
        </span>
      </div>

      <div
        className={cx(s.zone, armed && !full && s.armed, over && !full && s.over, full && s.full)}
        onClick={pick}
        onDragEnter={() => setOver(true)}
        onDragOver={() => !over && setOver(true)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
      >
        <span className={s.stack} aria-hidden="true">
          <i />
          <i />
          <i>
            <Icon name={full ? "check" : "up"} size={16} strokeWidth={2.4} />
          </i>
        </span>
        <div className={s.zoneText}>
          {full ? (
            <b>
              All {max} {max === 1 ? "slot" : "slots"} used
            </b>
          ) : over ? (
            <b>Drop to attach</b>
          ) : armed ? (
            <b>Drop files anywhere to attach them</b>
          ) : (
            <b>
              <span className={s.dropOnly}>Drop files here</span>
              <span className={s.touchOnly}>Attach files</span>
            </b>
          )}
          <div className={s.zoneSub}>
            {full ? "Remove a file or link to add another." : "PDF, Word, Excel, CSV, TXT or Markdown · up to 15 MB each"}
          </div>
        </div>
        {!full && (
          <button
            type="button"
            className={cx("btn sm", s.zoneBtn)}
            onClick={(e) => {
              e.stopPropagation();
              pick();
            }}
          >
            <Icon name="plus" />
            Add files
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            if (e.target.files?.length) att.addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <form className={s.linkRow} onSubmit={submitLink} noValidate>
        <div className={s.linkField}>
          <Icon name="link" size={16} />
          <label htmlFor="att-link" className="sr-only">
            Add a link to a public web page
          </label>
          <input
            id="att-link"
            className="f"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={2000}
            placeholder={full ? "Remove a file or link to add a page" : "Add a link — https://…"}
            value={link}
            disabled={full}
            aria-invalid={linkErr ? true : undefined}
            aria-describedby={linkErr ? "att-link-err" : undefined}
            onChange={(e) => {
              setLink(e.target.value);
              if (linkErr) setLinkErr(null);
            }}
          />
        </div>
        <button type="submit" className="btn" disabled={full || linkBusy || !link.trim()} aria-busy={linkBusy}>
          {linkBusy ? "Reading page…" : "Add link"}
        </button>
      </form>
      {linkErr && (
        <div id="att-link-err" className={s.linkErr} role="alert">
          <Icon name="alert" size={16} />
          <span>
            {linkErr.message}
            {linkErr.tip && <span className={s.tip}>{linkErr.tip}</span>}
          </span>
        </div>
      )}

      {att.rejections.length > 0 && (
        <div className={cx("notice", s.rejections)} role="status">
          <Icon name="alert" />
          <ul>
            {att.rejections.map((r) => (
              <li key={r.key}>
                <b>{r.name}</b> — {r.reason}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={s.iconBtn}
            style={{ width: 28, height: 28, color: "inherit", marginTop: -4, marginRight: -6 }}
            onClick={() => att.rejections.forEach((r) => att.dismissRejection(r.key))}
            aria-label="Dismiss"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      {att.items.length > 0 && (
        <ul className={s.list} aria-label="Attached materials">
          {att.items.map((it) => (
            <Row key={it.key} it={it} onRemove={() => att.remove(it.key)} onRetry={() => att.retry(it.key)} />
          ))}
        </ul>
      )}

      <div className={s.privacy}>
        <Icon name="lock" />
        <span>
          Files are read in your browser — only their text is uploaded. It stays private to you and is shared with our AI provider (
          {config.aiProviderLabel}) only to run your task. Web pages are fetched by Ensemblis.
        </span>
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </section>
  );
}

/** For guests and visitors: a gentle prompt instead of the attachment tools (and drops don't navigate away). */
export function AttachGate({ guest }: { guest: boolean }) {
  const toast = useToast();
  const message = guest ? "Create a free account to attach files and links." : "Sign up to attach files and links.";
  useWindowFileDrop(false, () => {}, () => toast.info(message, { icon: "lock" }));
  return (
    <div className={s.gate}>
      <Icon name="file" size={16} />
      <span>
        {guest ? (
          <>
            <Link href={signupUrl("company", "/new")}>Create a free account</Link> to attach PDFs, documents, spreadsheets and links.
          </>
        ) : (
          <>
            <Link href={signupUrl("company", "/new")}>Sign up to attach files</Link> — PDFs, documents, spreadsheets and links. Have an
            account? <Link href={loginUrl("/new")}>Log in</Link>
          </>
        )}
      </span>
    </div>
  );
}
