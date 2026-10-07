"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type GalleryItem } from "@/lib/api";
import { Avatar, EmptyState, Icon, Skeleton, SkeletonText } from "@/components";
import { ExportMenu, ReportView, reportTitle } from "@/components/report";
import { errorText } from "@/lib/errors";
import { ROUTES } from "@/lib/routes";
import E from "../examples.module.css";

type State = { kind: "loading" } | { kind: "ok"; item: GalleryItem } | { kind: "missing" } | { kind: "error"; message: string };

/** A sensible starting brief for "/new?q=", derived from the example's title. */
export function briefFor(item: Pick<GalleryItem, "title">): string {
  const topic = item.title.replace(/\s+/g, " ").trim().replace(/[.:;,\s]+$/, "");
  return `${topic}: produce a report like this for my company. Cover the key facts and figures, the main players or options, risks and opportunities, and finish with clear recommendations and next steps. Cite sources.`;
}

export function ExampleDetail({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const { item } = await api.getGalleryItem(slug);
      if (!item) setState({ kind: "missing" });
      else setState({ kind: "ok", item });
    } catch (e) {
      if (e instanceof ApiError && [400, 403, 404].includes(e.status)) setState({ kind: "missing" });
      else setState({ kind: "error", message: errorText(e, "Couldn't load this example") });
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

  const back = (
    <Link className="btn sm ghost" href={ROUTES.examples}>
      <Icon name="back" />
      All examples
    </Link>
  );

  if (state.kind === "missing") {
    return (
      <div className="narrow" style={{ padding: "56px 0" }}>
        <EmptyState icon="file" title="Example not found" action={{ label: "Browse all examples", href: ROUTES.examples }}>
          This example may have been removed or renamed.
        </EmptyState>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="wrap" style={{ paddingTop: 22 }}>
        {back}
        <div className="notice" role="alert" style={{ marginTop: 16, alignItems: "center" }}>
          <Icon name="alert" />
          <span className="sp">{state.message}</span>
          <button type="button" className="btn sm" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state.kind === "loading") {
    return (
      <div className="wrap" style={{ paddingTop: 22 }} aria-busy="true" aria-label="Loading example">
        {back}
        <Skeleton height={42} radius={10} style={{ marginTop: 16 }} />
        <div className={E.head}>
          <Skeleton width={180} height={20} />
          <Skeleton width="68%" height={44} style={{ marginTop: 16 }} />
          <Skeleton width="50%" height={14} style={{ marginTop: 18 }} />
        </div>
        <div className="card" style={{ padding: 28 }}>
          <SkeletonText lines={8} />
        </div>
      </div>
    );
  }

  const it = state.item;
  const content = it.content ?? "";
  const title = reportTitle(content) || it.title;
  const sources = it.sources ?? [];
  const similarHref = `${ROUTES.newTask}?q=${encodeURIComponent(briefFor(it))}&depth=${encodeURIComponent(it.depth)}`;

  return (
    <div className="wrap" style={{ paddingTop: 22 }}>
      {back}

      <div
        className="notice"
        role="note"
        style={{ marginTop: 16, ...(it.isExample ? {} : { background: "var(--ok-soft)", color: "var(--ok)" }) }}
      >
        <Icon name={it.isExample ? "info" : "star"} />
        <span>
          {it.isExample ? (
            <>
              <b>Example report</b> — written to demonstrate the format; sources were checked when written.
            </>
          ) : (
            <>
              <b>Featured report</b> from a real Ensemblis task. AI-generated: verify important facts before relying on them.
            </>
          )}
        </span>
      </div>

      <header className={E.head}>
        <div className="row wrapflex" style={{ gap: 8 }}>
          <span className="tag">{it.category || "Report"}</span>
          {it.isExample ? <span className="tag gray">Example</span> : <span className="tag ok">Featured</span>}
          <span className="tag gray">
            {it.depth.charAt(0).toUpperCase() + it.depth.slice(1)} depth
          </span>
          {sources.length > 0 && <span className="tag gray">{sources.length} sources</span>}
        </div>
        <h1>{title}</h1>
        {it.summary && <p className={E.lede}>{it.summary}</p>}
        <div className="row wrapflex between" style={{ marginTop: 18, gap: 12 }}>
          <div className="row" style={{ gap: 10, minWidth: 0 }}>
            <Avatar name={it.agentName} size="sm" />
            <span className="small muted">
              Led by <b style={{ color: "var(--ink)" }}>{it.agentName}</b>
            </span>
          </div>
          <div className="row wrapflex" style={{ gap: 8 }}>
            <ExportMenu
              title={title}
              markdown={content}
              sources={sources}
              meta={{ date: it.createdAt, depth: it.depth, agent: it.agentName, label: it.isExample ? "Example report" : "Featured report", category: it.category }}
            />
            <Link className="btn p" href={similarHref}>
              <Icon name="plus" />
              Run a similar task
            </Link>
          </div>
        </div>
      </header>

      <ReportView
        markdown={content}
        sources={sources}
        idPrefix="e"
        tocExtra={[{ id: "similar", label: "Run a similar task" }]}
        emptyText="This example has no content yet."
      >
        <section id="similar" className={`card ${E.similar}`} aria-labelledby="similar-h">
          <span className="tag">Your turn</span>
          <h3 id="similar-h" className="serif" style={{ fontSize: 26, margin: "12px 0 6px" }}>
            Want this for your company?
          </h3>
          <p className="small muted" style={{ maxWidth: "58ch" }}>
            We&apos;ll start a new task with a brief based on this report. Edit it to fit your market, then review the plan and price before anything runs.
          </p>
          <div className="row wrapflex" style={{ marginTop: 14, gap: 10 }}>
            <Link className="btn p" href={similarHref}>
              Run a similar task
              <Icon name="arrow" />
            </Link>
            <Link className="btn" href={ROUTES.examples}>
              See more examples
            </Link>
          </div>
        </section>
      </ReportView>
    </div>
  );
}
