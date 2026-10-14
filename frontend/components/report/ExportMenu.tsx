"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { TaskSource } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/Toast";
import { buildMarkdownFile, copyText, fileSlug, saveBlob, type ExportMeta } from "./shared";
import s from "./report.module.css";

export interface ExportMenuProps {
  title: string;
  markdown: string;
  sources?: TaskSource[] | null;
  meta?: ExportMeta;
  /** Button label (default "Export"). */
  label?: string;
  /** Use the primary button style. */
  primary?: boolean;
  className?: string;
}

type Kind = "pdf" | "docx" | "md" | "copy";

const ITEMS: { kind: Kind; title: string; sub: string; fmt: string; cls?: string }[] = [
  { kind: "pdf", title: "PDF document", sub: "Formatted, with page numbers and a sources appendix", fmt: "PDF", cls: s.fmtPdf },
  { kind: "docx", title: "Word document", sub: "Editable in any word processor", fmt: "DOC", cls: s.fmtDoc },
  { kind: "md", title: "Markdown file", sub: "Plain text for your docs or wiki", fmt: "MD" },
  { kind: "copy", title: "Copy to clipboard", sub: "The full report as Markdown, with sources", fmt: "" },
];

/** "Export ▾" → PDF / Word / Markdown / Copy. Heavy libraries load only on click. */
export function ExportMenu({ title, markdown, sources, meta, label = "Export", primary, className }: ExportMenuProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [place, setPlace] = useState<CSSProperties | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const empty = !markdown.trim();

  /** Keep the menu on-screen: full-width under the button on phones, flipped near the left edge. */
  const placeMenu = () => {
    const r = wrap.current?.getBoundingClientRect();
    const vw = window.innerWidth;
    if (r && vw < 600) setPlace({ position: "fixed", left: 12, right: 12, top: Math.max(12, Math.min(r.bottom + 6, window.innerHeight - 360)), minWidth: 0 });
    else if (r && r.right < 300) setPlace({ left: 0, right: "auto" });
    else setPlace(undefined);
  };

  const close = useCallback((focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  }, []);

  // Close on outside pointer, keep it on-screen.
  useEffect(() => {
    if (!open) return;
    const on = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", on);
    // A phone-width menu is fixed to the viewport, so close it when the page scrolls.
    if (window.innerWidth < 600) window.addEventListener("scroll", onScroll, { passive: true });
    const t = requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    return () => {
      document.removeEventListener("pointerdown", on);
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(t);
    };
  }, [open]);

  const deliver = (blob: Blob, name: string) => {
    if (saveBlob(blob, name)) {
      toast(`Downloaded ${name}`, { icon: "dl" });
      return;
    }
    let url: string | null = null;
    try {
      url = URL.createObjectURL(blob);
    } catch {
      url = null;
    }
    if (url) {
      const u = url;
      toast.error("Your browser blocked the download.", {
        duration: 9000,
        action: { label: "Open instead", onClick: () => window.open(u, "_blank", "noopener,noreferrer") },
      });
    } else toast.error("Downloads aren't available in this browser. Use Copy instead.");
  };

  const run = async (kind: Kind) => {
    if (busy) return;
    setBusy(kind);
    const input = { title, markdown, sources: sources ?? [], meta };
    const base = `${fileSlug(title)}${meta?.version && meta.version > 1 ? `-v${meta.version}` : ""}`;
    try {
      if (kind === "pdf") {
        const { exportPdf } = await import("./export-pdf");
        deliver(await exportPdf(input), `${base}.pdf`);
      } else if (kind === "docx") {
        const { exportDocx } = await import("./export-docx");
        deliver(await exportDocx(input), `${base}.docx`);
      } else if (kind === "md") {
        deliver(new Blob([buildMarkdownFile(input)], { type: "text/markdown;charset=utf-8" }), `${base}.md`);
      } else {
        const ok = await copyText(buildMarkdownFile(input));
        if (ok) toast.info("Report copied as Markdown", { icon: "copy" });
        else toast.error("Couldn't copy: your browser blocked clipboard access. Try the Markdown download.");
      }
      close(true);
    } catch {
      toast.error(
        kind === "pdf"
          ? "Couldn't create the PDF. Try again, or download Word or Markdown instead."
          : kind === "docx"
            ? "Couldn't create the Word file. Try again, or download PDF or Markdown instead."
            : "Something went wrong with the export. Please try again."
      );
    } finally {
      setBusy(null);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrap} className={[s.exportWrap, "no-print", className].filter(Boolean).join(" ")}>
      <button
        ref={trigger}
        type="button"
        className={primary ? "btn p" : "btn"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={empty}
        title={empty ? "Nothing to export yet" : undefined}
        onClick={() => {
          if (!open) placeMenu();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            placeMenu();
            setOpen(true);
          }
        }}
      >
        <Icon name="dl" />
        {label}
        <Icon name="down" size={14} />
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Export this report"
          className={`menu ${s.exportMenu}`}
          style={place}
          onKeyDown={onMenuKey}
        >
          <div className="mh">Download or copy</div>
          {ITEMS.map((it) => (
            <div key={it.kind}>
              {it.kind === "copy" && <hr />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={busy !== null && busy !== it.kind ? true : undefined}
                aria-busy={busy === it.kind}
                onClick={() => run(it.kind)}
              >
                <span className={[s.fmt, it.cls].filter(Boolean).join(" ")} aria-hidden="true">
                  {busy === it.kind ? <span className="spin" /> : it.fmt || <Icon name="copy" size={16} />}
                </span>
                <span className={s.miText}>
                  <b>{busy === it.kind ? (it.kind === "copy" ? "Copying…" : "Preparing…") : it.title}</b>
                  <span>{it.sub}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
