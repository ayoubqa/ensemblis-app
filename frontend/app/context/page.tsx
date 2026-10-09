"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type CompanyContext, type ContextPayload, type MemoryItem } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { ACCEPT, detectKind, extractFile, ExtractError, unsupportedReason } from "@/lib/extract";
import { num, plural, relativeTime } from "@/lib/format";
import { EmptyState, Icon, Modal, PageHead, PageSkeleton, RequireAuth, Tag, useToast } from "@/components";

export default function ContextPage() {
  return (
    <RequireAuth>
      <CompanyContextView />
    </RequireAuth>
  );
}

type FieldKey = "companyName" | "description" | "products" | "businessModel" | "customers" | "markets" | "goals";
interface Field {
  key: FieldKey;
  label: string;
  hint: string;
  rows: number;
  max: number;
}

// Labels are asserted by the end-to-end tests — keep them exactly as written.
const FIELDS: Record<FieldKey, Field> = {
  companyName: { key: "companyName", label: "Company", hint: "The name your organization uses.", rows: 1, max: 160 },
  description: { key: "description", label: "What the company does", hint: "One paragraph: what you do and for whom.", rows: 3, max: 4000 },
  products: { key: "products", label: "Products & services", hint: "What you sell, key features, price points.", rows: 3, max: 4000 },
  businessModel: { key: "businessModel", label: "Business model", hint: "How you make money (subscription, licence, services…).", rows: 2, max: 2000 },
  customers: { key: "customers", label: "Customers / ICP", hint: "Who buys, which roles decide, what triggers a purchase.", rows: 3, max: 4000 },
  markets: { key: "markets", label: "Markets & geographies", hint: "Where you sell today and where you want to go.", rows: 2, max: 2000 },
  goals: { key: "goals", label: "Business goals", hint: "This year's priorities and targets.", rows: 3, max: 4000 },
};
const ALL_FIELDS = Object.values(FIELDS);

const GROUPS: { title: string; sub: string; fields: FieldKey[] }[] = [
  { title: "Identity", sub: "Who you are, in your own words.", fields: ["companyName", "description"] },
  { title: "Offer", sub: "What you sell and how you earn.", fields: ["products", "businessModel"] },
  { title: "Market", sub: "Who buys, and where.", fields: ["customers", "markets"] },
  { title: "Direction", sub: "What the business is working towards.", fields: ["goals"] },
];

function CompanyContextView() {
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState<ContextPayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<CompanyContext>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [memory, setMemory] = useState<MemoryItem[] | null>(null);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const d = await api.getContext();
      setData(d);
      setForm(d.context);
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);
  const loadMemory = useCallback(async () => setMemory((await api.listMemory()).memories), []);
  useEffect(() => {
    load();
    loadMemory().catch(() => setMemory([]));
  }, [load, loadMemory]);

  if (!data && failed)
    return (
      <div className="wrap op-page">
        <PageHead eyebrow="Company Context" title="What Ensemblis knows about your business" />
        <EmptyState icon="alert" title="Company Context couldn't be loaded" action={{ label: "Try again", onClick: () => void load() }}>
          {failed}
        </EmptyState>
      </div>
    );
  if (!data) return <PageSkeleton cards={2} />;

  const dirty = ALL_FIELDS.some((f) => (form[f.key] ?? "") !== (data.context[f.key] ?? "")) || (form.website ?? "") !== data.context.website;
  const setField = (k: FieldKey | "website", v: string) => {
    setSavedAt(null);
    setForm((x) => ({ ...x, [k]: v }));
  };
  const onData = (d: ContextPayload) => {
    setData(d);
    setForm(d.context);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      for (const f of ALL_FIELDS) body[f.key] = String(form[f.key] ?? "");
      body.website = String(form.website ?? "");
      const d = await api.updateContext(body);
      onData(d);
      setSavedAt(Date.now());
      toast("Company Context saved — every objective will use it");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const { filled, total, missing } = data.completeness;
  const pct = total ? Math.round((filled / total) * 100) : 0;
  const active = memory?.filter((m) => m.status === "ACTIVE").length ?? 0;
  const waiting = memory?.filter((m) => m.status === "PENDING_CONFIRMATION").length ?? 0;
  const guest = !!user?.isGuest;

  return (
    <div className="wrap op-page">
      <PageHead
        eyebrow="Company Context"
        title="What Ensemblis knows about your business"
        sub="Stable knowledge every objective uses automatically, so you never repeat it. Documents and your website are read as evidence the AI Team can cite — never as instructions."
      />

      <nav className="op-glance" aria-label="Company Context at a glance">
        <a href="#profile" className={filled < total ? "op-kpi is-warn" : "op-kpi"}>
          <span className="op-kpi-l">
            <Icon name="building" />
            Company profile
          </span>
          <span className="op-kpi-v">
            {num(filled)}
            <small>/{num(total)}</small>
          </span>
          <span className="op-kpi-m">{filled < total ? `${plural(total - filled, "section")} still missing` : "All sections complete"}</span>
          <span className="op-bar" role="presentation">
            <i style={{ width: `${pct}%` }} />
          </span>
        </a>
        <a href="#website" className="op-kpi">
          <span className="op-kpi-l">
            <Icon name="globe" />
            Website
          </span>
          <span className="op-kpi-v">{data.context.websiteFetchedAt ? "Read" : "Not read"}</span>
          <span className="op-kpi-m">
            {data.context.websiteFetchedAt ? `${relativeTime(data.context.websiteFetchedAt)} · ${num(data.context.websiteChars)} characters` : "Add your site so it can be cited"}
          </span>
        </a>
        <a href="#documents" className="op-kpi">
          <span className="op-kpi-l">
            <Icon name="file" />
            Documents
          </span>
          <span className="op-kpi-v">
            {num(data.documents.length)}
            <small>/{num(data.maxDocuments)}</small>
          </span>
          <span className="op-kpi-m">searched passage by passage for each step</span>
        </a>
        <a href="#memory" className={waiting ? "op-kpi is-warn" : "op-kpi"}>
          <span className="op-kpi-l">
            <Icon name="layers" />
            Memory
          </span>
          <span className="op-kpi-v">{memory ? num(active) : "—"}</span>
          <span className="op-kpi-m">{waiting ? `${plural(waiting, "item")} waiting for you` : "active items, used in every plan"}</span>
        </a>
      </nav>

      <div className="op-ctx">
        <div style={{ minWidth: 0 }}>
          <section id="profile" className="op-sec" style={{ marginTop: 0 }} aria-labelledby="h-profile">
            <div className="op-sec-head">
              <div>
                <h2 id="h-profile">Company profile</h2>
                <p className="op-sec-sub">The Chief of Staff plans with this and asks only for what is missing.</p>
              </div>
            </div>
            <div className="op-panel">
              {GROUPS.map((g) => (
                <div key={g.title} className="op-fgroup">
                  <div className="op-fgroup-h">
                    <h3>{g.title}</h3>
                    <p>{g.sub}</p>
                  </div>
                  <div className="op-fields">
                    {g.fields.map((k) => {
                      const f = FIELDS[k];
                      const value = String(form[k] ?? "");
                      const id = `ctx-${k}`;
                      return (
                        <div key={k} className="op-field">
                          <div className="op-field-l">
                            <label className="l" htmlFor={id}>
                              {f.label}
                            </label>
                            {value.trim() && (
                              <span className="op-filled" aria-hidden="true">
                                <Icon name="check" />
                                Filled
                              </span>
                            )}
                          </div>
                          {f.rows === 1 ? (
                            <input id={id} className="f" value={value} maxLength={f.max} aria-describedby={`${id}-hint`} onChange={(e) => setField(k, e.target.value)} />
                          ) : (
                            <textarea id={id} className="f" rows={f.rows} value={value} maxLength={f.max} aria-describedby={`${id}-hint`} onChange={(e) => setField(k, e.target.value)} />
                          )}
                          <p className="hint" id={`${id}-hint`}>
                            {f.hint}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className={dirty || savedAt ? "op-savebar is-sticky" : "op-savebar"}>
                <span className={`op-save-state${dirty ? " is-dirty" : savedAt ? " is-saved" : ""}`} role="status">
                  {dirty ? (
                    <>
                      <Icon name="edit" />
                      Changes pending
                    </>
                  ) : savedAt ? (
                    <>
                      <Icon name="check" />
                      Saved — every new objective uses it
                    </>
                  ) : data.context.updatedAt ? (
                    `Last updated ${relativeTime(data.context.updatedAt)}`
                  ) : (
                    "Nothing on file yet"
                  )}
                </span>
                <button type="button" className="btn p" onClick={save} disabled={!dirty || saving} aria-busy={saving} data-testid="save-context">
                  Save Company Context
                </button>
              </div>
            </div>
          </section>

          <section id="website" className="op-sec" aria-labelledby="h-website">
            <div className="op-sec-head">
              <div>
                <h2 id="h-website">Website</h2>
                <p className="op-sec-sub">Public information the AI Team can cite as evidence.</p>
              </div>
            </div>
            <WebsiteCard data={data} value={String(form.website ?? "")} onChange={(v) => setField("website", v)} onData={onData} />
          </section>

          <section id="documents" className="op-sec" aria-labelledby="h-docs">
            <div className="op-sec-head">
              <div>
                <h2 id="h-docs">
                  Documents <span className="op-count">{`${num(data.documents.length)}/${num(data.maxDocuments)}`}</span>
                </h2>
                <p className="op-sec-sub">Pricing sheets, strategy decks, customer research and financials make results much more specific.</p>
              </div>
            </div>
            <Documents data={data} onData={setData} guest={guest} />
          </section>
        </div>

        <aside className="op-aside" aria-label="How Company Context is used">
          <div className="op-panel op-pad">
            <h2>How it is used</h2>
            <ul>
              <li>
                <Icon name="compass" />
                The Chief of Staff plans with it and asks only for what is missing.
              </li>
              <li>
                <Icon name="report" />
                Specialists cite it as evidence (“Company profile”).
              </li>
              <li>
                <Icon name="file" />
                Relevant document passages are retrieved for each step.
              </li>
              <li>
                <Icon name="lock" />
                It is private to your organization; shared reports never show document text.
              </li>
            </ul>
            {missing.length > 0 && (
              <p className="op-missing">
                <b>Still missing:</b> {missing.join(", ")}.
              </p>
            )}
          </div>
        </aside>
      </div>

      <Memory items={memory} reload={loadMemory} />
    </div>
  );
}

function WebsiteCard({ data, value, onChange, onData }: { data: ContextPayload; value: string; onChange: (v: string) => void; onData: (d: ContextPayload) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const read = async () => {
    setBusy(true);
    try {
      if (value !== data.context.website) await api.updateContext({ website: value });
      const d = await api.refreshWebsite();
      onData(d);
      toast(`Read ${num(d.context.websiteChars)} characters from your website`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="op-panel op-pad">
      <label className="l" htmlFor="ctx-website">
        Website address
      </label>
      <div className="op-inline">
        <input id="ctx-website" className="f" type="url" inputMode="url" placeholder="https://yourcompany.com" value={value} aria-describedby="ctx-website-hint" onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="btn" onClick={read} disabled={busy || !value} aria-busy={busy}>
          <Icon name="globe" />
          Read website
        </button>
      </div>
      <p className="hint" id="ctx-website-hint">
        {data.context.websiteFetchedAt
          ? `Read ${relativeTime(data.context.websiteFetchedAt)} (${num(data.context.websiteChars)} characters). The Planning Analyst uses it as evidence.`
          : "Only public pages are read, from our servers. Nothing on your site is changed."}
      </p>
    </div>
  );
}

function ConfirmDelete({ what, detail, onConfirm, onClose }: { what: string | null; detail: ReactNode; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={!!what} onClose={() => !busy && onClose()} title={what ?? ""} dismissible={!busy}>
      <p className="muted small" style={{ margin: "6px 0 16px" }}>
        {detail}
      </p>
      <div className="row wrapflex">
        <button type="button" className="btn" onClick={onClose} disabled={busy} data-autofocus>
          Keep it
        </button>
        <button
          type="button"
          className="btn bad"
          disabled={busy}
          aria-busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="trash" />
          Delete
        </button>
      </div>
    </Modal>
  );
}

function Documents({ data, onData, guest }: { data: ContextPayload; onData: (d: ContextPayload) => void; guest: boolean }) {
  const toast = useToast();
  const { config } = useConfig();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const kind = detectKind(file.name, file.type);
      if (!kind) {
        toast.error(unsupportedReason(file.name));
        continue;
      }
      setBusy(file.name);
      try {
        const r = await extractFile(file, kind, { maxChars: config.maxAttachmentChars || 40000 });
        const d = await api.addDocument({ kind, name: file.name, text: r.text });
        onData(d);
        toast(r.truncated ? `Added ${file.name} (${r.note ?? "truncated to fit"})` : `Added ${file.name}`);
      } catch (e) {
        toast.error(e instanceof ExtractError ? e.message : (e as Error).message);
      } finally {
        setBusy(null);
      }
    }
    if (input.current) input.current.value = "";
  };
  const addLink = async () => {
    setBusy("link");
    try {
      onData(await api.addLinkDocument(link.trim()));
      setLink("");
      toast("Page added");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!removing) return;
    try {
      onData(await api.deleteDocument(removing.id));
      toast(`Removed ${removing.name}`);
      setRemoving(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  if (guest) {
    return (
      <EmptyState icon="file" title="Create a free account to add documents">
        Guest trials can use the profile above; documents are kept for registered organizations.
      </EmptyState>
    );
  }
  const full = data.documents.length >= data.maxDocuments;
  return (
    <>
      <div className="op-panel op-pad">
        <div className="op-inline">
          <button type="button" className="btn" onClick={() => input.current?.click()} disabled={!!busy || full} aria-busy={!!busy && busy !== "link"}>
            <Icon name="file" />
            Upload documents
          </button>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => add(e.target.files)} />
          <span className="op-meta">PDF, Word, Excel, CSV, Markdown or text</span>
        </div>
        <p className="hint">Text is extracted in your browser; the files themselves are never uploaded.</p>
        <div style={{ marginTop: 16 }}>
          <label className="l" htmlFor="ctx-link">
            Or add a public page by link
          </label>
          <div className="op-inline">
            <input id="ctx-link" className="f" type="url" inputMode="url" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} disabled={full} />
            <button type="button" className="btn" onClick={addLink} disabled={!link.trim() || !!busy || full} aria-busy={busy === "link"}>
              <Icon name="link" />
              Add link
            </button>
          </div>
        </div>
        <div role="status" aria-live="polite">
          {busy && busy !== "link" && (
            <p className="op-busy">
              <span className="spin" aria-hidden="true" style={{ width: 14, height: 14 }} />
              Reading {busy}…
            </p>
          )}
        </div>
      </div>
      {data.documents.length > 0 ? (
        <ul className="op-panel" aria-label="Documents on file">
          {data.documents.map((d) => (
            <li key={d.id} className="op-docrow">
              <span className="op-ico" aria-hidden="true">
                {d.kind === "url" ? <Icon name="link" /> : <span className="op-kind">{d.kind.toUpperCase()}</span>}
              </span>
              <div style={{ minWidth: 0 }}>
                <b title={d.name}>{d.name}</b>
                <span className="op-meta">
                  {d.kind === "url" ? "Web page" : d.kind.toUpperCase()} · {num(d.charCount)} characters · added {relativeTime(d.createdAt)}
                </span>
              </div>
              <button type="button" className="ibtn" aria-label={`Remove ${d.name}`} onClick={() => setRemoving({ id: d.id, name: d.name })}>
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="op-panel op-quiet">
          <Icon name="file" />
          No documents yet.
        </div>
      )}
      <ConfirmDelete
        what={removing ? `Remove ${removing.name}?` : null}
        detail="The AI Team will stop citing it in new executions. Reports that already cite it keep their evidence."
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
    </>
  );
}

const KINDS: MemoryItem["kind"][] = ["PREFERENCE", "DECISION", "LESSON", "CONSTRAINT", "FACT"];
const kindLabel = (k: string) => k.charAt(0) + k.slice(1).toLowerCase();

function Memory({ items, reload }: { items: MemoryItem[] | null; reload: () => Promise<void> }) {
  const toast = useToast();
  const [filter, setFilter] = useState<string>("ALL");
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [newKind, setNewKind] = useState<MemoryItem["kind"]>("PREFERENCE");
  const [newText, setNewText] = useState("");
  const [deleting, setDeleting] = useState<MemoryItem | null>(null);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      await reload();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };
  const pending = items?.filter((m) => m.status === "PENDING_CONFIRMATION") ?? [];
  const active = items?.filter((m) => m.status === "ACTIVE") ?? [];
  const shown = [...pending, ...active].filter((m) => filter === "ALL" || (filter === "WAITING" ? m.status === "PENDING_CONFIRMATION" : m.kind === filter));
  const filters: { id: string; label: string; n: number }[] = [
    { id: "ALL", label: "All", n: pending.length + active.length },
    ...(pending.length ? [{ id: "WAITING", label: "Waiting for you", n: pending.length }] : []),
    ...KINDS.map((k) => ({ id: k, label: kindLabel(k), n: [...pending, ...active].filter((m) => m.kind === k).length })).filter((f) => f.n > 0),
  ];
  const short = (s: string) => (s.length > 48 ? `${s.slice(0, 48)}…` : s);

  const row = (m: MemoryItem) => {
    const isPending = m.status === "PENDING_CONFIRMATION";
    return (
      <li key={m.id} className={isPending ? "op-memrow is-pending" : "op-memrow"} data-testid="memory-item">
        <div style={{ minWidth: 0 }}>
          <div className="op-tags">
            <Tag variant="gray">{kindLabel(m.kind)}</Tag>
            {isPending ? <Tag variant="warn">Waiting for confirmation</Tag> : <Tag variant="ok">Active</Tag>}
            {m.sensitive && <Tag variant="warn">Sensitive</Tag>}
            <span className="op-meta">
              {m.source === "user" ? "Added by your organization" : "Learned from an execution"} · {relativeTime(m.createdAt)}
              {m.lastUsedAt ? ` · last used ${relativeTime(m.lastUsedAt)}` : ""}
            </span>
          </div>
          {editing === m.id ? (
            <div className="op-memedit">
              <label className="sr-only" htmlFor={`mem-edit-${m.id}`}>
                Edit memory
              </label>
              <input
                id={`mem-edit-${m.id}`}
                className="f"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={600}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(null);
                  }
                }}
              />
              <button
                type="button"
                className="btn sm p"
                disabled={text.trim().length < 5}
                onClick={async () => {
                  if (await run(() => api.updateMemory(m.id, { content: text.trim() }), "Memory updated")) setEditing(null);
                }}
              >
                Save
              </button>
              <button type="button" className="btn sm ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <p>{m.content}</p>
          )}
          {m.rationale && <p className="op-why">Why: {m.rationale}</p>}
        </div>
        <div className="op-memrow-act">
          {isPending && (
            <button type="button" className="btn sm p" onClick={() => run(() => api.updateMemory(m.id, { status: "ACTIVE" }), "Confirmed — it will be used from now on")}>
              <Icon name="check" />
              Confirm
            </button>
          )}
          <button
            type="button"
            className="ibtn"
            aria-label={`Edit memory: ${short(m.content)}`}
            onClick={() => {
              setEditing(m.id);
              setText(m.content);
            }}
          >
            <Icon name="edit" />
          </button>
          <button type="button" className="ibtn" aria-label={`Delete memory: ${short(m.content)}`} onClick={() => setDeleting(m)}>
            <Icon name="trash" />
          </button>
        </div>
      </li>
    );
  };

  return (
    <section id="memory" className="op-sec" style={{ marginTop: 52 }} aria-labelledby="h-memory">
      <div className="op-sec-head">
        <div>
          <h2 id="h-memory">
            <Icon name="layers" />
            Memory {items && <span className="op-count">{num(active.length)}</span>}
            {pending.length > 0 && <span className="op-count is-warn">{num(pending.length)} waiting</span>}
          </h2>
          <p className="op-sec-sub">
            What Ensemblis learned from operations: preferences, decisions, lessons, constraints and facts. Only active items are used. Low-risk preferences are remembered automatically; anything consequential or sensitive waits for your confirmation.
          </p>
        </div>
      </div>

      {items && items.length > 0 && filters.length > 2 && (
        <div className="op-mem-tools">
          <div className="op-tags" role="group" aria-label="Filter memory">
            {filters.map((f) => (
              <button key={f.id} type="button" className={filter === f.id ? "chip on" : "chip"} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} <span className="op-meta">{num(f.n)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {items === null ? (
        <div className="op-panel op-quiet">Loading memory…</div>
      ) : shown.length ? (
        <ul className="op-panel" aria-label="Memory items">
          {shown.map(row)}
        </ul>
      ) : (
        <div className="op-panel op-quiet">
          <Icon name="layers" />
          {filter === "ALL" ? "Nothing remembered yet. Completed executions propose what is worth keeping; you can also add items below." : "Nothing in this group."}
        </div>
      )}

      <form
        className="op-panel op-memadd"
        onSubmit={async (e) => {
          e.preventDefault();
          if (newText.trim().length < 5) return;
          if (await run(() => api.addMemory({ kind: newKind, content: newText.trim() }), "Remembered")) setNewText("");
        }}
      >
        <div>
          <label className="l" htmlFor="mem-kind">
            Type
          </label>
          <select id="mem-kind" className="f" value={newKind} onChange={(e) => setNewKind(e.target.value as MemoryItem["kind"])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </div>
        <div style={{ minWidth: 0 }}>
          <label className="l" htmlFor="mem-new">
            Something Ensemblis should always keep in mind
          </label>
          <input id="mem-new" className="f" placeholder="e.g. Board decks use euros, not dollars" value={newText} maxLength={600} onChange={(e) => setNewText(e.target.value)} />
        </div>
        <button type="submit" className="btn" disabled={newText.trim().length < 5}>
          <Icon name="plus" />
          Add to memory
        </button>
      </form>

      <ConfirmDelete
        what={deleting ? "Delete this memory?" : null}
        detail={deleting ? `“${short(deleting.content)}” will no longer be used when planning or executing objectives.` : ""}
        onConfirm={async () => {
          if (deleting && (await run(() => api.deleteMemory(deleting.id), "Memory deleted"))) setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}
