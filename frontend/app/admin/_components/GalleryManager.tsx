"use client";

import Link from "next/link";
import { useState } from "react";
import { EmptyState, Icon, Modal, useToast } from "@/components";
import { api, type AdminOverview, type GalleryItem } from "@/lib/api";
import { toastApiError } from "@/lib/errors";
import { dayLabel, plural } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

type Shareable = AdminOverview["shareableReports"][number];

const TITLE_MAX = 120;
const SUMMARY_MAX = 280;

/**
 * Curate /examples: feature reports their owners made public, and take
 * featured reports down again. Built-in examples ship with the app.
 */
export function GalleryManager({ shareable, gallery, onChanged }: { shareable: Shareable[]; gallery: GalleryItem[]; onChanged: () => void | Promise<void> }) {
  const toast = useToast();
  const [featuring, setFeaturing] = useState<Shareable | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<GalleryItem | null>(null);

  const openFeature = (r: Shareable) => {
    setFeaturing(r);
    setTitle("");
    setSummary("");
  };

  const feature = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!featuring) return;
    setBusy(true);
    try {
      const { item } = await api.adminFeature({
        taskId: featuring.taskId,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
      });
      toast(`“${item.title}” is now in the gallery`, { icon: "check" });
      setFeaturing(null);
      await onChanged();
    } catch (err) {
      toastApiError(toast, err, "Couldn't feature this report");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.adminUnfeature(removing.slug);
      toast(`Removed “${removing.title}” from the gallery`);
      setRemoving(null);
      await onChanged();
    } catch (err) {
      toastApiError(toast, err, "Couldn't remove this item");
    } finally {
      setBusy(false);
    }
  };

  const featuredCount = gallery.filter((g) => !g.isExample).length;

  return (
    <section aria-labelledby="h-gallery" style={{ marginTop: 30 }}>
      <div className="row between wrapflex" style={{ marginBottom: 10, gap: 10 }}>
        <div>
          <h3 id="h-gallery" style={{ margin: 0 }}>
            Gallery
          </h3>
          <p className="small muted" style={{ margin: "2px 0 0" }}>
            Feature great reports on the public{" "}
            <Link href={ROUTES.examples} style={{ color: "var(--accent)", fontWeight: 600 }}>
              Examples
            </Link>{" "}
            page. Only reports their owners shared publicly can be featured.
          </p>
        </div>
        <span className="tag gray">
          {plural(gallery.length, "item")} live · {featuredCount} featured
        </span>
      </div>

      <div className="grid g2" style={{ alignItems: "start" }}>
        {/* Shareable reports */}
        <div className="card tight">
          <div className="eyebrow">SHARED REPORTS</div>
          {shareable.length === 0 ? (
            <EmptyState icon="share" title="No shared reports yet" card={false}>
              When a customer turns on a public link for a finished report, it shows up here so you can feature it.
            </EmptyState>
          ) : (
            <div>
              {shareable.map((r) => (
                <div key={r.taskId} className="lane" style={{ alignItems: "flex-start" }}>
                  <div className="sp" style={{ minWidth: 0 }}>
                    <b className="small" style={{ display: "block", overflowWrap: "anywhere" }}>
                      {r.title}
                    </b>
                    <div className="tiny muted row wrapflex" style={{ gap: 8 }}>
                      <span>{r.completedAt ? `Completed ${dayLabel(r.completedAt)}` : "Completed"}</span>
                      <a href={ROUTES.sharedReport(r.shareToken)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600 }}>
                        Open public link
                        <Icon name="ext" size={12} style={{ marginLeft: 3, verticalAlign: "-1px" }} />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </div>
                  </div>
                  {r.featured ? (
                    <span className="tag ok" style={{ flex: "none" }}>
                      <Icon name="check" />
                      In gallery
                    </span>
                  ) : (
                    <button type="button" className="btn sm" style={{ flex: "none" }} onClick={() => openFeature(r)}>
                      <Icon name="star" />
                      Feature
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Current gallery */}
        <div className="card tight">
          <div className="eyebrow">IN THE GALLERY NOW</div>
          {gallery.length === 0 ? (
            <EmptyState icon="file" title="The gallery is empty" card={false}>
              Feature a shared report to give visitors a real example of what Ensemblis delivers.
            </EmptyState>
          ) : (
            <div>
              {gallery.map((g) => (
                <div key={g.slug} className="lane" style={{ alignItems: "flex-start" }}>
                  <div className="sp" style={{ minWidth: 0 }}>
                    <Link href={ROUTES.example(g.slug)} className="small" style={{ fontWeight: 700, color: "inherit", display: "block", overflowWrap: "anywhere" }}>
                      {g.title}
                    </Link>
                    <div className="tiny muted">
                      {[g.category, g.agentName].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {g.isExample ? (
                    <span className="tag gray" style={{ flex: "none" }} title="Curated examples ship with the app and can't be removed here.">
                      Example
                    </span>
                  ) : (
                    <>
                      <span className="tag ok hideS" style={{ flex: "none" }}>
                        Featured
                      </span>
                      <button type="button" className="btn sm" style={{ flex: "none" }} onClick={() => setRemoving(g)} aria-label={`Remove “${g.title}” from the gallery`}>
                        <Icon name="trash" />
                        Remove
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Feature modal */}
      <Modal open={!!featuring} onClose={() => !busy && setFeaturing(null)} title="Feature in the gallery" dismissible={!busy}>
        <form onSubmit={feature}>
          <p className="muted small" style={{ margin: "6px 0 14px" }}>
            <b style={{ color: "var(--ink)" }}>{featuring?.title}</b> will appear publicly on the Examples page, labelled as a real report. Skim it
            first: make sure it contains nothing confidential.
          </p>
          <label className="l" htmlFor="gf-title">
            Gallery title <span className="muted">(optional)</span>
          </label>
          <input
            id="gf-title"
            className="f"
            value={title}
            maxLength={TITLE_MAX}
            placeholder={featuring?.title}
            onChange={(e) => setTitle(e.target.value)}
            data-autofocus
          />
          <label className="l" htmlFor="gf-summary" style={{ marginTop: 12 }}>
            Card summary <span className="muted">(optional)</span>
          </label>
          <textarea
            id="gf-summary"
            className="f"
            rows={3}
            value={summary}
            maxLength={SUMMARY_MAX}
            placeholder="One or two sentences on what this report shows."
            onChange={(e) => setSummary(e.target.value)}
            aria-describedby="gf-hint"
          />
          <div className="hint" id="gf-hint">
            Leave either field empty to use a default. {summary.length}/{SUMMARY_MAX}
          </div>
          {featuring && (
            <a href={ROUTES.sharedReport(featuring.shareToken)} target="_blank" rel="noopener noreferrer" className="tiny" style={{ color: "var(--accent)", fontWeight: 600, display: "inline-block", marginTop: 10 }}>
              Review the public report first <Icon name="ext" size={12} />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          <div className="row wrapflex" style={{ marginTop: 16 }}>
            <button type="button" className="btn" onClick={() => setFeaturing(null)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn p" disabled={busy} aria-busy={busy}>
              <Icon name="star" />
              Feature report
            </button>
          </div>
        </form>
      </Modal>

      {/* Remove confirm */}
      <Modal open={!!removing} onClose={() => !busy && setRemoving(null)} title="Remove from the gallery?" dismissible={!busy}>
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          <b style={{ color: "var(--ink)" }}>{removing?.title}</b> will no longer appear on the Examples page. The report itself and its owner&apos;s
          public link are not affected, and you can feature it again later.
        </p>
        <div className="row wrapflex">
          <button type="button" className="btn" onClick={() => setRemoving(null)} disabled={busy} data-autofocus>
            Keep it
          </button>
          <button type="button" className="btn bad" onClick={remove} disabled={busy} aria-busy={busy}>
            <Icon name="trash" />
            Remove from gallery
          </button>
        </div>
      </Modal>
    </section>
  );
}
