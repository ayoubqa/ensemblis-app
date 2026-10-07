"use client";

import { useRef, type CSSProperties } from "react";
import type { Attachment, Task, TaskSource } from "@/lib/api";
import { Icon, Skeleton } from "@/components";
import { KIND_LABEL, safeHref, sortSources, sourceDomain, sourceInitial } from "@/components/report";
import { useConfig } from "@/lib/config";
import { num } from "@/lib/format";
import { hueFrom } from "@/lib/utils";
import L from "./live.module.css";

const ATT_LABEL: Record<Attachment["kind"], string> = {
  pdf: "PDF",
  csv: "CSV",
  xlsx: "Excel",
  docx: "Word",
  txt: "Text",
  md: "Markdown",
  url: "Link",
};

/** Attachment chips ("Your materials"). */
export function Materials({ attachments, style }: { attachments: Attachment[]; style?: CSSProperties }) {
  if (!attachments.length) return null;
  return (
    <div className={L.materials} style={style}>
      {attachments.map((a) => {
        const href = a.kind === "url" ? safeHref(a.url) : null;
        const inner = (
          <>
            <Icon name={a.kind === "url" ? "link" : "file"} size={14} />
            <span>{a.name}</span>
            <em className="tiny muted" style={{ fontStyle: "normal" }}>
              {ATT_LABEL[a.kind] ?? a.kind}
              {a.charCount ? ` · ${num(a.charCount)} chars` : ""}
            </em>
          </>
        );
        return href ? (
          <a key={a.id} className={L.matChip} href={href} target="_blank" rel="noopener noreferrer" title={a.url ?? a.name}>
            {inner}
          </a>
        ) : (
          <span key={a.id} className={L.matChip} title={a.name}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}

const badgeStyle = (s: TaskSource) => ({ ["--h" as string]: hueFrom(sourceDomain(s) || s.title || String(s.n)) }) as CSSProperties;

/** Phase 0: the research desk, shown while the team gathers sources before step 1 starts. */
export function Gathering({ task }: { task: Task }) {
  const { config, loaded } = useConfig();
  const sources = sortSources(task.sources);
  const attachments = task.attachments ?? [];
  // Stagger only the sources that arrived in the same poll.
  const delays = useRef(new Map<number, number>());
  let batch = 0;
  for (const s of sources) if (!delays.current.has(s.n)) delays.current.set(s.n, Math.min(batch++, 8) * 90);

  const searching = loaded && config.searchEnabled;
  const heading = searching
    ? "Searching the web for evidence"
    : attachments.length
      ? "Reading your materials"
      : "Reading your brief";
  const sub = searching
    ? `${config.searchProviderLabel && config.searchProviderLabel !== "Off" ? `${config.searchProviderLabel}: ` : ""}the team collects sources first, then cites them in the report as [n].`
    : "The team reviews what you provided before the first agent starts.";

  // A few dots on the radar, one per found source (deterministic positions).
  const dots = sources.slice(0, 10).map((s) => {
    const a = (hueFrom(`${s.n}${s.title}`) / 360) * Math.PI * 2;
    const r = 18 + (s.n % 3) * 8;
    return { n: s.n, left: 38 + Math.cos(a) * r - 3, top: 38 + Math.sin(a) * r - 3 };
  });

  return (
    <section className={`card ${L.gather}`} aria-labelledby="gather-h">
      <div className={L.gatherHead}>
        <div className={L.radar} aria-hidden="true">
          <i />
          <i />
          <i />
          <span className={L.sweep} />
          {dots.map((d) => (
            <span key={d.n} className={L.radarDot} style={{ left: `${(d.left / 76) * 100}%`, top: `${(d.top / 76) * 100}%` }} />
          ))}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">BEFORE STEP 1 · GATHERING SOURCES</div>
          <h3 id="gather-h" style={{ fontSize: 20 }}>
            {heading}
            <span className="caret" aria-hidden="true" />
          </h3>
          <p className="small muted" style={{ marginTop: 4 }}>
            {sub}
          </p>
        </div>
        <div className={L.count} aria-live="polite">
          <b>{sources.length}</b>
          <span>{sources.length === 1 ? "source found" : "sources found"}</span>
        </div>
      </div>

      {attachments.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 6 }}>
            Your materials
          </div>
          <Materials attachments={attachments} />
        </div>
      )}

      {sources.length > 0 ? (
        <ol className={L.feed} aria-label="Sources found so far">
          {sources.map((s) => {
            const own = s.kind === "upload" || s.kind === "link";
            return (
              <li key={s.n} className={L.feedItem} style={{ animationDelay: `${delays.current.get(s.n) ?? 0}ms` }}>
                <span className={L.srcBadge} style={badgeStyle(s)} aria-hidden="true">
                  {s.kind === "upload" ? <Icon name="file" size={16} /> : sourceInitial(s)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className={L.srcTitle}>
                    <span className="tiny muted" style={{ fontWeight: 700, marginRight: 6 }}>
                      [{s.n}]
                    </span>
                    {s.title}
                  </div>
                  <div className={L.srcSub}>{sourceDomain(s) ?? (s.snippet || " ")}</div>
                </div>
                <span className={own ? `${L.kind} ${L.kindMine}` : L.kind}>{KIND_LABEL[s.kind] ?? "Source"}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <div style={{ marginTop: 18 }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="row" style={{ gap: 12, padding: "9px 0", opacity: 1 - i * 0.25 }}>
              <Skeleton width={34} height={34} radius={10} />
              <div className="sp">
                <Skeleton height={11} width={`${72 - i * 12}%`} />
                <Skeleton height={9} width={`${40 - i * 6}%`} style={{ marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Compact sidebar list of the sources the agents are working from. */
export function SourcesMini({ sources }: { sources: TaskSource[] }) {
  const list = sortSources(sources);
  if (!list.length) return null;
  const top = list.slice(-6).reverse();
  return (
    <div className="card">
      <div className="row between">
        <b className="small">Sources in play</b>
        <span className="tag gray">{list.length}</span>
      </div>
      <ul className={L.mini}>
        {top.map((s) => (
          <li key={s.n} title={s.title}>
            <span className={L.miniN}>[{s.n}]</span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.title}
              {sourceDomain(s) && <span className="muted"> · {sourceDomain(s)}</span>}
            </span>
          </li>
        ))}
      </ul>
      {list.length > top.length && <p className="tiny muted" style={{ marginTop: 6 }}>+ {list.length - top.length} more. The full list comes with the report.</p>}
    </div>
  );
}
