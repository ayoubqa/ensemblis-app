"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CompanyContext, type ContextPayload, type MemoryItem } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { ACCEPT, detectKind, extractFile, ExtractError, unsupportedReason } from "@/lib/extract";
import { num, relativeTime } from "@/lib/format";
import { EmptyState, Icon, PageHead, PageSkeleton, RequireAuth, Tag, useToast } from "@/components";
import { Section } from "@/components/ops";

export default function ContextPage() {
  return (
    <RequireAuth>
      <CompanyContextView />
    </RequireAuth>
  );
}

const FIELDS: { key: keyof CompanyContext; label: string; hint: string; rows: number; max: number }[] = [
  { key: "companyName", label: "Company", hint: "The name your team uses.", rows: 1, max: 160 },
  { key: "description", label: "What the company does", hint: "One paragraph: what you do and for whom.", rows: 3, max: 4000 },
  { key: "products", label: "Products & services", hint: "What you sell, key features, price points.", rows: 3, max: 4000 },
  { key: "businessModel", label: "Business model", hint: "How you make money (subscription, licence, services…).", rows: 2, max: 2000 },
  { key: "customers", label: "Customers / ICP", hint: "Who buys, which roles decide, what triggers a purchase.", rows: 3, max: 4000 },
  { key: "markets", label: "Markets & geographies", hint: "Where you sell today and where you want to go.", rows: 2, max: 2000 },
  { key: "goals", label: "Business goals", hint: "This year's priorities and targets.", rows: 3, max: 4000 },
];

function CompanyContextView() {
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState<ContextPayload | null>(null);
  const [form, setForm] = useState<Partial<CompanyContext>>({});
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const d = await api.getContext();
    setData(d);
    setForm(d.context);
  }, []);
  useEffect(() => {
    load().catch((e) => toast.error((e as Error).message));
  }, [load, toast]);

  if (!data) return <PageSkeleton cards={2} />;
  const dirty = FIELDS.some((f) => (form[f.key] ?? "") !== (data.context[f.key] ?? "")) || (form.website ?? "") !== data.context.website;

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      for (const f of FIELDS) body[f.key] = String(form[f.key] ?? "");
      body.website = String(form.website ?? "");
      const d = await api.updateContext(body);
      setData(d);
      setForm(d.context);
      toast("Company Context saved — every objective will use it");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="wrap" style={{ maxWidth: 1080, paddingBottom: 48 }}>
      <PageHead
        eyebrow="COMPANY CONTEXT"
        title="What Ensemblis knows about your business"
        sub="Stable knowledge every objective uses automatically, so you never repeat it. Documents and your website are read as evidence the AI Team can cite — never as instructions."
        actions={
          <span className="tag gray">
            {data.completeness.filled}/{data.completeness.total} sections · {data.documents.length} documents
          </span>
        }
      />

      <div className="console">
        <div style={{ minWidth: 0 }}>
          <Section title="Company profile">
            <div className="card">
              {FIELDS.map((f) => (
                <div key={f.key} style={{ marginBottom: 16 }}>
                  <label className="l" htmlFor={`ctx-${f.key}`}>
                    {f.label}
                  </label>
                  {f.rows === 1 ? (
                    <input id={`ctx-${f.key}`} className="f" value={String(form[f.key] ?? "")} maxLength={f.max} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} />
                  ) : (
                    <textarea id={`ctx-${f.key}`} className="f" rows={f.rows} value={String(form[f.key] ?? "")} maxLength={f.max} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} />
                  )}
                  <p className="hint">{f.hint}</p>
                </div>
              ))}
              <div className="row wrapflex" style={{ position: "sticky", bottom: 12 }}>
                <button type="button" className="btn p" onClick={save} disabled={!dirty || saving} aria-busy={saving} data-testid="save-context">
                  Save Company Context
                </button>
                {data.context.updatedAt && <span className="tiny muted">Last updated {relativeTime(data.context.updatedAt)}</span>}
              </div>
            </div>
          </Section>

          <Section title="Website / public information">
            <WebsiteCard data={data} form={form} setForm={setForm} onData={(d) => { setData(d); setForm(d.context); }} />
          </Section>

          <Section title="Documents" count={`${data.documents.length}/${data.maxDocuments}`}>
            <Documents data={data} onData={setData} guest={!!user?.isGuest} />
          </Section>
        </div>
        <aside className="side">
          <div className="card tight">
            <h2 className="sh">How it is used</h2>
            <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
              <li>The Chief of Staff plans with it and asks only for what is missing.</li>
              <li>Specialists cite it as evidence (“Company profile”).</li>
              <li>Relevant document passages are retrieved per step.</li>
              <li>It is private to your organization; public share pages never show document text.</li>
            </ul>
            {data.completeness.missing.length > 0 && (
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Still missing: {data.completeness.missing.join(", ")}.
              </p>
            )}
          </div>
        </aside>
      </div>

      <Memory />
    </div>
  );
}

function WebsiteCard({ data, form, setForm, onData }: { data: ContextPayload; form: Partial<CompanyContext>; setForm: (f: (x: Partial<CompanyContext>) => Partial<CompanyContext>) => void; onData: (d: ContextPayload) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const read = async () => {
    setBusy(true);
    try {
      if ((form.website ?? "") !== data.context.website) await api.updateContext({ website: String(form.website ?? "") });
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
    <div className="card tight">
      <label className="l" htmlFor="ctx-website">
        Website
      </label>
      <div className="row" style={{ gap: 8 }}>
        <input id="ctx-website" className="f" placeholder="https://yourcompany.com" value={String(form.website ?? "")} onChange={(e) => setForm((x) => ({ ...x, website: e.target.value }))} />
        <button type="button" className="btn" onClick={read} disabled={busy || !form.website} aria-busy={busy}>
          Read website
        </button>
      </div>
      <p className="hint">
        {data.context.websiteFetchedAt
          ? `Read ${relativeTime(data.context.websiteFetchedAt)} (${num(data.context.websiteChars)} characters). The Planning Analyst uses it as evidence.`
          : "Fetched server-side with SSRF protection; only public pages are read."}
      </p>
    </div>
  );
}

function Documents({ data, onData, guest }: { data: ContextPayload; onData: (d: ContextPayload) => void; guest: boolean }) {
  const toast = useToast();
  const { config } = useConfig();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState("");
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
  const remove = async (id: string) => {
    try {
      onData(await api.deleteDocument(id));
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
  return (
    <div className="card tight">
      <div className="row wrapflex" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={!!busy || data.documents.length >= data.maxDocuments} aria-busy={!!busy && busy !== "link"}>
          <Icon name="file" />
          Upload documents
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => add(e.target.files)} />
        <input className="f" style={{ flex: 1, minWidth: 200 }} placeholder="…or paste a link to a page" value={link} onChange={(e) => setLink(e.target.value)} />
        <button type="button" className="btn" onClick={addLink} disabled={!link.trim() || !!busy} aria-busy={busy === "link"}>
          Add link
        </button>
      </div>
      <p className="hint">PDF, Word, Excel, CSV, Markdown or text. Text is extracted in your browser; files themselves are never uploaded.</p>
      {busy && busy !== "link" && <p className="small muted">Reading {busy}…</p>}
      <ul className="evlist" style={{ marginTop: 10 }}>
        {data.documents.map((d) => (
          <li key={d.id} style={{ gridTemplateColumns: "34px minmax(0,1fr) auto" }}>
            <span className="evn">
              <Icon name={d.kind === "url" ? "link" : "file"} size={13} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="small" style={{ fontWeight: 600 }}>
                {d.name}
              </div>
              <div className="tiny muted">
                {d.kind.toUpperCase()} · {num(d.charCount)} characters · added {relativeTime(d.createdAt)}
              </div>
            </div>
            <button type="button" className="ibtn" aria-label={`Remove ${d.name}`} onClick={() => remove(d.id)}>
              <Icon name="trash" />
            </button>
          </li>
        ))}
      </ul>
      {!data.documents.length && <p className="small muted">No documents yet. Pricing sheets, strategy decks, customer research and financials make results much more specific.</p>}
    </div>
  );
}

const KINDS: MemoryItem["kind"][] = ["PREFERENCE", "DECISION", "LESSON", "CONSTRAINT", "FACT"];

function Memory() {
  const toast = useToast();
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [newKind, setNewKind] = useState<MemoryItem["kind"]>("PREFERENCE");
  const [newText, setNewText] = useState("");
  const load = useCallback(async () => setItems((await api.listMemory()).memories), []);
  useEffect(() => {
    load().catch(() => setItems([]));
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const pending = items?.filter((m) => m.status === "PENDING_CONFIRMATION") ?? [];
  const active = items?.filter((m) => m.status === "ACTIVE") ?? [];
  const row = (m: MemoryItem) => (
    <div key={m.id} className="row2" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} data-testid="memory-item">
      <div>
        <div className="row wrapflex" style={{ gap: 6 }}>
          <Tag variant="gray">{m.kind.toLowerCase()}</Tag>
          {m.sensitive && <Tag variant="warn">sensitive</Tag>}
          <span className="tiny muted">
            {m.source === "user" ? "added by your team" : "learned from an execution"} · {relativeTime(m.createdAt)}
            {m.lastUsedAt ? ` · last used ${relativeTime(m.lastUsedAt)}` : ""}
          </span>
        </div>
        {editing === m.id ? (
          <div className="row" style={{ marginTop: 6, gap: 6 }}>
            <input className="f" value={text} onChange={(e) => setText(e.target.value)} maxLength={600} aria-label="Edit memory" />
            <button type="button" className="btn sm p" onClick={() => run(() => api.updateMemory(m.id, { content: text }), "Memory updated").then(() => setEditing(null))}>
              Save
            </button>
          </div>
        ) : (
          <p className="small" style={{ marginTop: 4 }}>
            {m.content}
          </p>
        )}
        {m.rationale && <p className="tiny muted">{m.rationale}</p>}
      </div>
      <div className="row" style={{ gap: 4 }}>
        {m.status === "PENDING_CONFIRMATION" && (
          <button type="button" className="btn sm p" onClick={() => run(() => api.updateMemory(m.id, { status: "ACTIVE" }), "Confirmed — it will be used from now on")}>
            Confirm
          </button>
        )}
        <button type="button" className="ibtn" aria-label="Edit" onClick={() => { setEditing(m.id); setText(m.content); }}>
          <Icon name="edit" />
        </button>
        <button type="button" className="ibtn" aria-label="Delete" onClick={() => run(() => api.deleteMemory(m.id), "Memory deleted")}>
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
  return (
    <Section id="memory" title="Memory" count={items ? active.length : undefined}>
      <p className="small muted" style={{ marginBottom: 10 }}>
        What Ensemblis learned from operations: preferences, decisions, lessons and constraints. Only confirmed (active) items are used. Low-risk preferences are remembered automatically; anything consequential or sensitive waits for your confirmation.
      </p>
      {pending.length > 0 && (
        <>
          <h3 className="sh" style={{ color: "var(--warn)" }}>
            Waiting for your confirmation<span className="ct">{pending.length}</span>
          </h3>
          <div className="crit" style={{ marginBottom: 14 }}>{pending.map(row)}</div>
        </>
      )}
      <div className="crit">
        {active.map(row)}
        {!active.length && <div className="row2" style={{ gridTemplateColumns: "1fr" }}><span className="small muted">Nothing remembered yet.</span></div>}
      </div>
      <div className="row wrapflex" style={{ marginTop: 12, gap: 8 }}>
        <select className="f" style={{ width: 150 }} value={newKind} onChange={(e) => setNewKind(e.target.value as MemoryItem["kind"])} aria-label="Memory type">
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k.charAt(0) + k.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <input className="f" style={{ flex: 1, minWidth: 220 }} placeholder="Add something Ensemblis should always keep in mind" value={newText} maxLength={600} onChange={(e) => setNewText(e.target.value)} />
        <button type="button" className="btn" disabled={newText.trim().length < 5} onClick={() => run(() => api.addMemory({ kind: newKind, content: newText.trim() }), "Remembered").then(() => setNewText(""))}>
          Add
        </button>
      </div>
    </Section>
  );
}
