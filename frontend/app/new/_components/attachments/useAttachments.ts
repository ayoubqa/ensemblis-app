"use client";

// Attachment state for the new-task flow. Lives in the page (not the Describe
// step) so uploads keep going and results survive moving between steps.
// Files are read in the browser (./extract), then only the text is uploaded.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type AttachmentKind } from "@/lib/api";
import { errorText } from "@/lib/errors";
import type { SavedAttachment } from "../draft";
import { MAX_FILE_BYTES, clampText, detectKind, unsupportedReason, type ExtractProgress, type FileKind } from "./extract";

export type AttachmentStatus = "reading" | "uploading" | "ready" | "error";

export interface AttachmentItem {
  /** Local key (stable across status changes). */
  key: string;
  kind: AttachmentKind;
  name: string;
  url: string | null;
  status: AttachmentStatus;
  progress: ExtractProgress | null;
  /** Server id once uploaded. */
  id: string | null;
  charCount: number;
  truncatedTo: number | null;
  note: string | null;
  size: number | null;
  error: string | null;
  /** A "Try again" makes sense (network/server trouble, not a bad file). */
  retryable: boolean;
  ownerId: string | null;
}

export interface Rejection {
  key: string;
  name: string;
  reason: string;
}

export interface LinkError {
  message: string;
  tip: string | null;
}

/** Stay safely under the attachments route's 400 kB JSON body limit. */
const MAX_BODY_BYTES = 380_000;

let seq = 0;
const newKey = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() || "Untitled";
  if (base.length <= 180) return base;
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : "";
  return base.slice(0, 180 - ext.length - 1) + "…" + ext;
}

function fitBody(text: string): { text: string; cut: boolean } {
  let t = text;
  let cut = false;
  const enc = new TextEncoder();
  for (let i = 0; i < 8 && enc.encode(JSON.stringify(t)).length > MAX_BODY_BYTES; i++) {
    t = clampText(t, Math.floor(t.length * 0.8)).text;
    cut = true;
  }
  return { text: t, cut };
}

function uploadError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Can't reach the Ensemblis server. Check your connection and try again.";
    if (e.status === 413) return "This file's text is too large to upload. Try a shorter file.";
  }
  return errorText(e, fallback);
}

function linkError(e: unknown): LinkError {
  const message = uploadError(e, "Couldn't read that page.");
  let tip: string | null = null;
  if (/\bpdf\b/i.test(message)) tip = "Download the PDF and add it with “Add files” instead.";
  else if (/private|local|internal|intranet|not allowed|blocked/i.test(message)) tip = "Only public web pages can be read. For internal documents, download them and add the file instead.";
  else if (/timed? ?out|too slow|unreachable|couldn.t (reach|fetch|load)|404|not found/i.test(message))
    tip = "Check the address opens in your browser without signing in, or attach the content as a file.";
  return { message, tip };
}

/** "example.com/path" → "https://example.com/path"; null if it isn't a usable web address. */
export function normalizeLink(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/\s/.test(s) || !/^[^/]+\.[a-z]{2,}/i.test(s)) return null;
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function fromSaved(a: SavedAttachment): AttachmentItem {
  return {
    key: newKey(),
    kind: a.kind,
    name: a.name,
    url: a.url,
    status: "ready",
    progress: null,
    id: a.id,
    charCount: a.charCount,
    truncatedTo: a.truncatedTo,
    note: a.note,
    size: null,
    error: null,
    retryable: false,
    ownerId: a.ownerId,
  };
}

const active = (i: AttachmentItem) => i.status !== "error";

export function useAttachments({ max, maxChars, userId }: { max: number; maxChars: number; userId: string | null }) {
  const [items, setItems] = useState<AttachmentItem[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const filesRef = useRef(new Map<string, File>());
  const cancelledRef = useRef(new Set<string>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const optsRef = useRef({ maxChars, userId });
  optsRef.current = { maxChars, userId };

  const mine = useCallback((i: { ownerId: string | null }) => !!userId && (!i.ownerId || i.ownerId === userId), [userId]);

  const patch = useCallback((key: string, p: Partial<AttachmentItem>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  }, []);

  const processFile = useCallback(
    async (key: string, file: File, kind: FileKind) => {
      const ctrl = new AbortController();
      controllersRef.current.set(key, ctrl);
      const cancelled = () => cancelledRef.current.has(key);
      try {
        const { extractFile } = await import("./extract");
        const res = await extractFile(file, kind, {
          maxChars: optsRef.current.maxChars,
          signal: ctrl.signal,
          onProgress: (p) => !cancelled() && patch(key, { progress: p }),
        });
        if (cancelled()) return;
        patch(key, { status: "uploading", progress: { label: "Uploading…" } });
        const body = fitBody(res.text);
        const { attachment } = await api.createAttachment({ kind, name: cleanName(file.name), text: body.text });
        if (cancelled()) {
          api.deleteAttachment(attachment.id).catch(() => {});
          return;
        }
        filesRef.current.delete(key);
        const limit = optsRef.current.maxChars;
        // Cut below the configured limit by the body-size guard: show the real count.
        const cutDeeper = body.cut;
        patch(key, {
          status: "ready",
          progress: null,
          id: attachment.id,
          name: attachment.name || cleanName(file.name),
          charCount: attachment.charCount,
          truncatedTo: cutDeeper ? attachment.charCount : res.truncated ? limit : null,
          note: res.note,
          error: null,
        });
      } catch (e) {
        if (cancelled() || (e as { name?: string })?.name === "AbortError") return;
        const isFileProblem = (e as { name?: string })?.name === "ExtractError";
        patch(key, {
          status: "error",
          progress: null,
          error: isFileProblem ? (e as Error).message : uploadError(e, "Couldn't upload this file. Please try again."),
          // A bad file stays bad; a dropped connection, rate limit or server hiccup is worth retrying.
          retryable: !isFileProblem || /load the file reader/.test((e as Error).message),
        });
      } finally {
        controllersRef.current.delete(key);
      }
    },
    [patch]
  );

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const incoming = Array.from(list);
      if (!incoming.length) return;
      const current = itemsRef.current.filter((i) => mine(i) && active(i));
      let slots = Math.max(0, max - current.length);
      const rejected: Rejection[] = [];
      const added: AttachmentItem[] = [];
      const jobs: [string, File, FileKind][] = [];
      for (const f of incoming) {
        const kind = detectKind(f.name, f.type);
        if (!kind) {
          rejected.push({ key: newKey(), name: f.name || "File", reason: unsupportedReason(f.name) });
          continue;
        }
        if (f.size > MAX_FILE_BYTES) {
          rejected.push({ key: newKey(), name: f.name, reason: `${formatBytes(f.size)} is over the 15 MB limit. Try a smaller or split file.` });
          continue;
        }
        if (f.size === 0) {
          rejected.push({ key: newKey(), name: f.name, reason: "This file is empty." });
          continue;
        }
        if ([...current, ...added].some((i) => i.size === f.size && i.name === cleanName(f.name))) {
          rejected.push({ key: newKey(), name: f.name, reason: "Already attached." });
          continue;
        }
        if (slots <= 0) {
          rejected.push({
            key: newKey(),
            name: f.name,
            reason: `Not added — a task can have up to ${max} ${max === 1 ? "file or link" : "files and links"}.`,
          });
          continue;
        }
        slots--;
        const key = newKey();
        filesRef.current.set(key, f);
        added.push({
          key,
          kind,
          name: cleanName(f.name),
          url: null,
          status: "reading",
          progress: { label: "Reading…" },
          id: null,
          charCount: 0,
          truncatedTo: null,
          note: null,
          size: f.size,
          error: null,
          retryable: false,
          ownerId: optsRef.current.userId,
        });
        jobs.push([key, f, kind]);
      }
      setRejections(rejected);
      if (added.length) setItems((l) => [...l, ...added]);
      for (const [key, f, kind] of jobs) processFile(key, f, kind);
    },
    [max, mine, processFile]
  );

  const addLink = useCallback(
    async (raw: string): Promise<LinkError | null> => {
      const url = normalizeLink(raw);
      if (!url) return { message: "Enter a full web address, like https://example.com/report.", tip: null };
      const current = itemsRef.current.filter((i) => mine(i) && active(i));
      if (current.length >= max) return { message: `You've reached the limit of ${max} ${max === 1 ? "file or link" : "files and links"} for one task.`, tip: "Remove one to add this link." };
      if (current.some((i) => i.url === url)) return { message: "That link is already attached.", tip: null };
      setRejections([]);
      const key = newKey();
      let host = url;
      try {
        host = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        /* keep the url */
      }
      setItems((l) => [
        ...l,
        {
          key,
          kind: "url",
          name: host,
          url,
          status: "uploading",
          progress: { label: "Fetching page…" },
          id: null,
          charCount: 0,
          truncatedTo: null,
          note: null,
          size: null,
          error: null,
          retryable: false,
          ownerId: optsRef.current.userId,
        },
      ]);
      try {
        const { attachment } = await api.createLinkAttachment(url);
        if (cancelledRef.current.has(key)) {
          api.deleteAttachment(attachment.id).catch(() => {});
          return null;
        }
        patch(key, {
          status: "ready",
          progress: null,
          id: attachment.id,
          name: attachment.name || host,
          url: attachment.url || url,
          charCount: attachment.charCount,
          truncatedTo: attachment.charCount >= optsRef.current.maxChars ? optsRef.current.maxChars : null,
        });
        return null;
      } catch (e) {
        setItems((l) => l.filter((i) => i.key !== key));
        if (cancelledRef.current.has(key)) return null;
        return linkError(e);
      }
    },
    [max, mine, patch]
  );

  const remove = useCallback((key: string) => {
    const it = itemsRef.current.find((i) => i.key === key);
    if (!it) return;
    if (it.status === "ready" && it.id) api.deleteAttachment(it.id).catch(() => {});
    if (it.status === "reading" || it.status === "uploading") {
      cancelledRef.current.add(key);
      controllersRef.current.get(key)?.abort();
    }
    filesRef.current.delete(key);
    setItems((l) => l.filter((i) => i.key !== key));
  }, []);

  const retry = useCallback(
    (key: string) => {
      const it = itemsRef.current.find((i) => i.key === key);
      const file = filesRef.current.get(key);
      if (!it || !file || it.kind === "url") return;
      const used = itemsRef.current.filter((i) => mine(i) && active(i)).length;
      if (used >= max) {
        setRejections([{ key: newKey(), name: it.name, reason: `Remove another file or link first — a task can have up to ${max}.` }]);
        return;
      }
      patch(key, { status: "reading", error: null, retryable: false, progress: { label: "Reading…" } });
      processFile(key, file, it.kind as FileKind);
    },
    [max, mine, patch, processFile]
  );

  /** Restore uploaded attachments from a saved draft. */
  const restore = useCallback((saved: SavedAttachment[]) => {
    if (saved.length) setItems(saved.map(fromSaved));
  }, []);

  /** Forget every attachment (e.g. after the server says they expired). */
  const clearAll = useCallback(() => {
    for (const i of itemsRef.current) {
      if (i.status === "ready" && i.id) api.deleteAttachment(i.id).catch(() => {});
      if (i.status === "reading" || i.status === "uploading") {
        cancelledRef.current.add(i.key);
        controllersRef.current.get(i.key)?.abort();
      }
    }
    filesRef.current.clear();
    setItems([]);
    setRejections([]);
  }, []);

  const dismissRejection = useCallback((key: string) => setRejections((r) => r.filter((x) => x.key !== key)), []);

  // Abort in-flight extraction when the page unmounts.
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => controllers.forEach((c) => c.abort());
  }, []);

  /** Everything worth remembering in the draft (any owner — filtered on use). */
  const saved = useMemo<SavedAttachment[]>(
    () =>
      items
        .filter((i) => i.status === "ready" && i.id)
        .map((i) => ({
          id: i.id as string,
          kind: i.kind,
          name: i.name,
          url: i.url,
          charCount: i.charCount,
          truncatedTo: i.truncatedTo,
          note: i.note,
          ownerId: i.ownerId,
        })),
    [items]
  );

  /** What the signed-in user sees and can send. */
  const visible = useMemo(() => items.filter(mine), [items, mine]);
  const ready = useMemo(() => saved.filter(mine), [saved, mine]);
  const busyCount = visible.filter((i) => i.status === "reading" || i.status === "uploading").length;
  const used = visible.filter(active).length;

  return { items: visible, ready, saved, rejections, busyCount, used, addFiles, addLink, remove, retry, restore, clearAll, dismissRejection };
}

export type AttachmentsApi = ReturnType<typeof useAttachments>;
