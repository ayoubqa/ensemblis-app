"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Avatar, EmptyState, Icon, LineChart, Modal, RequireAuth, VerifiedTag, useToast } from "@/components";
import { api, type Agent, type DeveloperAgentStats, type PublishAgentInput } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CATS, PLATFORM_FEE_PERCENT } from "@/lib/data";
import { eur, longDate, minutesRange, num, pct } from "@/lib/format";
import { useIsMobile } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { seeded } from "@/lib/utils";
import { newTaskUrl } from "../../../agents/_components/AgentCard";
import { CapsInput } from "../../_components/CapsInput";
import { DevOnly } from "../../_components/DevOnly";
import { OUTPUT_TYPES, TIME_WINDOWS, findSecret, parsePriceCents } from "../../_components/agentForm";
import { TestRunPanel } from "./_components/TestRunPanel";

export default function ManageAgentPage() {
  return (
    <RequireAuth>
      <DevOnly what="managing agents">
        <Manage />
      </DevOnly>
    </RequireAuth>
  );
}

interface Form {
  name: string;
  category: string;
  description: string;
  capabilities: string[];
  specialty: string;
  taskType: string;
  outputType: string;
  priceEuros: string;
  estMinutesLow: number;
  estMinutesHigh: number;
  systemPrompt: string; // empty = keep current
}
const toForm = (a: Agent): Form => ({
  name: a.name,
  category: a.category,
  description: a.description,
  capabilities: [...a.capabilities],
  specialty: a.specialty,
  taskType: a.taskType,
  outputType: a.outputType,
  priceEuros: String(a.pricePerTaskCents / 100),
  estMinutesLow: a.estMinutesLow,
  estMinutesHigh: a.estMinutesHigh,
  systemPrompt: "",
});

function Manage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const mobile = useIsMobile();
  const [agent, setAgent] = useState<DeveloperAgentStats | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [market, setMarket] = useState<Agent[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [testRuns, setTestRuns] = useState<{ used: number; perDay: number } | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    api.developerStats().then(
      (s) => {
        if (!live) return;
        const a = s.agents.find((x) => x.id === id || x.slug === id) ?? null;
        setAgent(a);
        setMissing(!a);
        if (a) setForm(toForm(a));
        setTestRuns({ used: Number(s.testRunsToday) || 0, perDay: Number(s.testRunsPerDay) || 0 });
      },
      (e: Error) => live && setError(e.message)
    );
    api.listAgents().then((r) => live && setMarket(r.agents), () => {});
    return () => {
      live = false;
    };
  }, [id, reload]);

  useEffect(() => {
    if (agent) document.title = `Manage ${agent.name} · Ensemblis`;
  }, [agent]);

  // ---------- edit form ----------
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const changes = useMemo((): Partial<PublishAgentInput> => {
    if (!agent || !form) return {};
    const c: Partial<PublishAgentInput> = {};
    if (form.name.trim() !== agent.name) c.name = form.name.trim();
    if (form.category !== agent.category) c.category = form.category;
    if (form.description.trim() !== agent.description) c.description = form.description.trim();
    if (JSON.stringify(form.capabilities) !== JSON.stringify(agent.capabilities)) c.capabilities = form.capabilities;
    if (form.specialty.trim() !== agent.specialty) c.specialty = form.specialty.trim();
    if (form.taskType.trim() !== agent.taskType) c.taskType = form.taskType.trim();
    if (form.outputType.trim() !== agent.outputType) c.outputType = form.outputType.trim();
    const p = parsePriceCents(form.priceEuros);
    if (p !== null && p !== agent.pricePerTaskCents) c.pricePerTaskCents = p;
    if (form.estMinutesLow !== agent.estMinutesLow) c.estMinutesLow = form.estMinutesLow;
    if (form.estMinutesHigh !== agent.estMinutesHigh) c.estMinutesHigh = form.estMinutesHigh;
    if (form.systemPrompt.trim()) c.systemPrompt = form.systemPrompt.trim();
    return c;
  }, [agent, form]);
  const dirty = Object.keys(changes).length > 0;

  const validate = (f: Form): string | null => {
    if (f.name.trim().length < 2) return "Name needs at least 2 characters.";
    if (f.description.trim().length < 10) return "Description needs at least 10 characters.";
    if (!f.capabilities.length) return "Keep at least one capability.";
    if (!f.specialty.trim() || !f.taskType.trim() || !f.outputType.trim()) return "Specialty, task type and deliverable are required.";
    const p = parsePriceCents(f.priceEuros);
    if (p === null || p < 100 || p > 50000) return "Price must be between €1 and €500.";
    if (f.estMinutesHigh < f.estMinutesLow) return "The time window's upper bound must be at least the lower bound.";
    if (f.systemPrompt.trim() && f.systemPrompt.trim().length < 20) return "New instructions need at least 20 characters.";
    if (findSecret(f.systemPrompt)) return "Remove the credential from your instructions.";
    return null;
  };

  const save = async () => {
    if (!agent || !form || !dirty) return;
    const v = validate(form);
    if (v) {
      setFormErr(v);
      return;
    }
    setFormErr(null);
    setSaving(true);
    try {
      const { agent: updated } = await api.updateAgent(agent.id, changes);
      const merged = { ...agent, ...updated };
      setAgent(merged);
      setForm(toForm(merged));
      toast("Changes saved. They're live in the marketplace.");
    } catch (e) {
      setFormErr((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ---------- live toggle ----------
  const [confirmPause, setConfirmPause] = useState(false);
  const [toggling, setToggling] = useState(false);
  const setLive = async (isLive: boolean) => {
    if (!agent) return;
    setToggling(true);
    try {
      const { agent: updated } = await api.updateAgent(agent.id, { isLive });
      setAgent({ ...agent, ...updated });
      toast(isLive ? `${agent.name} is live again` : `${agent.name} is paused`, { icon: isLive ? "play" : "pause" });
      setConfirmPause(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setToggling(false);
    }
  };

  const wk = useMemo(() => {
    if (!agent) return [];
    const base = agent.successRate > 0 ? agent.successRate : 92;
    let h = 0;
    for (const ch of agent.id) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return seeded(h + 11, 12, base - 2, 3).map((x) => Math.min(99.5, x));
  }, [agent]);

  const tips = useMemo(() => {
    if (!agent) return [];
    const t: { text: string; action?: { label: string; href: string } }[] = [];
    const sameCat = market.filter((a) => a.category === agent.category).map((a) => a.pricePerTaskCents).sort((a, b) => a - b);
    const median = sameCat.length ? sameCat[Math.floor(sameCat.length / 2)] : null;
    if (agent.tasksRun === 0)
      t.push({
        text: "No completed tasks yet. Run a test task to see your agent work end to end.",
        action: testRuns && testRuns.perDay > 0 ? { label: "Run a free test", href: "#test-run" } : { label: "Run a test task", href: newTaskUrl({ agent: agent.slug }) },
      });
    if (agent.achievedRate !== null && agent.achievedRate < 85)
      t.push({ text: `${pct(agent.achievedRate)} of rated tasks were marked Achieved. Tighten the output format in your instructions to lift it.` });
    if (agent.capabilities.length < 3) t.push({ text: "Agents with 3+ capabilities get matched to more work." });
    if (agent.description.length < 60) t.push({ text: "Your description is short. Say what customers receive, not how it works." });
    if (median && agent.pricePerTaskCents > median * 2) t.push({ text: `You're priced above 2× the ${agent.category} median (${eur(median)}). Recommended ranking weighs price fit.` });
    if (!agent.verified) t.push({ text: "The Verified badge comes with a measured track record. Keep results consistent across tasks." });
    return t.slice(0, 3);
  }, [agent, market, testRuns]);

  if (error && !agent)
    return (
      <div className="wrap" style={{ paddingTop: 32 }}>
        <div className="notice" role="alert" style={{ background: "var(--bad-soft)", color: "var(--bad)" }}>
          <Icon name="alert" />
          <span className="sp">{error}</span>
          <button type="button" className="btn sm" onClick={() => setReload((n) => n + 1)}>
            <Icon name="redo" />
            Try again
          </button>
        </div>
      </div>
    );
  if (missing)
    return (
      <div className="narrow" style={{ padding: "56px 24px" }}>
        <EmptyState icon="search" title="This agent isn't one of yours." action={{ label: "Back to the developer console", href: ROUTES.devDashboard }}>
          You can only manage agents you published{user?.company ? ` as ${user.company}` : ""}.
        </EmptyState>
      </div>
    );
  if (!agent || !form)
    return (
      <div className="wrap" aria-busy="true">
        <div className="pagehead">
          <div className="sk" style={{ width: 120, height: 32 }} />
          <div className="sk" style={{ width: "50%", height: 40, marginTop: 14 }} />
        </div>
        <div className="grid g4 keep2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="sk" style={{ height: 84, borderRadius: 14 }} />
          ))}
        </div>
        <div className="sk" style={{ height: 260, borderRadius: 16, marginTop: 16 }} />
      </div>
    );

  const a = agent;

  return (
    <div className="wrap">
      <div className="pagehead">
        <Link className="btn sm" href={ROUTES.devDashboard}>
          <Icon name="back" />
          Dashboard
        </Link>
        <div className="row between wrapflex" style={{ marginTop: 14, gap: 16, alignItems: "flex-start" }}>
          <div className="row" style={{ gap: 16, minWidth: 0 }}>
            <Avatar name={a.name} hue={a.hue} size="lg" />
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0 }}>{a.name}</h1>
              <div className="row wrapflex" style={{ gap: 8, marginTop: 6 }}>
                <span className={a.isLive ? "tag ok" : "tag warn"}>
                  {a.isLive && <span className="pulse" style={{ width: 6, height: 6 }} />}
                  {a.isLive ? "Live" : "Paused"}
                </span>
                <VerifiedTag verified={a.verified} />
                <span className="tiny muted">Published {longDate(a.createdAt)}</span>
              </div>
            </div>
          </div>
          <div className="row wrapflex">
            <Link className="btn" href={ROUTES.agent(a.slug)}>
              <Icon name="ext" />
              Preview public page
            </Link>
            {a.isLive ? (
              <button type="button" className="btn" onClick={() => setConfirmPause(true)} disabled={toggling}>
                <Icon name="pause" />
                Pause
              </button>
            ) : (
              <button type="button" className="btn p" onClick={() => setLive(true)} disabled={toggling} aria-busy={toggling}>
                <Icon name="play" />
                Go live
              </button>
            )}
          </div>
        </div>
        <p style={{ marginTop: 12 }}>
          {a.isLive
            ? "Live in the marketplace. Every completed task adds to this agent's performance record."
            : "Paused. It's hidden from the marketplace and won't be matched to new work. Only you can open its page."}
        </p>
      </div>

      <div className="grid g4 keep2">
        <div className="stat">
          <b>{eur(a.revenueCents)}</b>
          <span>Your revenue ({100 - PLATFORM_FEE_PERCENT}%)</span>
        </div>
        <div className="stat">
          <b>{num(a.tasksRun)}</b>
          <span>Tasks completed on Ensemblis</span>
        </div>
        <div className="stat">
          <b>{a.achievedRate === null ? "—" : pct(a.achievedRate)}</b>
          <span>Outcome achieved</span>
        </div>
        <div className="stat">
          <b>{a.rating > 0 ? `${a.rating.toFixed(1)}/5` : "—"}</b>
          <span>Rating · {a.successRate > 0 ? `${pct(a.successRate)} success` : "no track record yet"}</span>
        </div>
      </div>

      <div className="grid g2" style={{ marginTop: 16, alignItems: "start" }}>
        <div className="card">
          <div className="row between">
            <h3>Success rate, last 12 weeks</h3>
            <span className="tag gray" style={{ fontSize: 11, padding: "1px 7px" }} title="Illustrative: per-week history isn't tracked yet">
              Illustrative
            </span>
          </div>
          <LineChart values={wk} min={Math.min(...wk) - 2} height={150} label="Success rate (illustrative)" format={(v) => `${v.toFixed(1)}%`} />
        </div>
        <div className="card">
          <h3>Improve this agent</h3>
          {tips.length ? (
            tips.map((t, i) => (
              <div key={i} className="notice" style={{ background: "var(--accent-soft)", color: "var(--accent)", margin: "10px 0" }}>
                <Icon name="spark" />
                <span className="sp">{t.text}</span>
                {t.action && (
                  <Link className="btn sm" href={t.action.href}>
                    {t.action.label}
                  </Link>
                )}
              </div>
            ))
          ) : (
            <p className="small muted" style={{ marginTop: 8 }}>
              Looking good. Keep results consistent and your ranking will follow.
            </p>
          )}
          <div className="row wrapflex" style={{ marginTop: 12 }}>
            <a className="btn p sm" href="#edit">
              <Icon name="edit" />
              Edit listing
            </a>
            <Link className="btn sm" href={ROUTES.agent(a.slug)}>
              View public profile
            </Link>
          </div>
        </div>
      </div>

      {testRuns && testRuns.perDay > 0 && (
        <TestRunPanel agent={a} used={testRuns.used} perDay={testRuns.perDay} onUsed={(n) => setTestRuns((r) => (r ? { ...r, used: Math.min(r.perDay, n) } : r))} />
      )}

      <h2 id="edit" className="serif" style={{ fontSize: 28, fontWeight: 500, margin: "36px 0 6px", scrollMarginTop: 90 }}>
        Edit listing
      </h2>
      <p className="small muted" style={{ marginBottom: 14 }}>
        Changes go live immediately. The public link stays the same.
      </p>
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid" style={{ gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 16 }}>
          <div>
            <label className="l" htmlFor="m-name">
              Agent name
            </label>
            <input id="m-name" className="f" maxLength={80} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div>
            <label className="l" htmlFor="m-cat">
              Category
            </label>
            <select id="m-cat" className="f" value={form.category} onChange={(e) => set("category", e.target.value)}>
              {[...new Set([...CATS, form.category])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <label className="l" htmlFor="m-desc" style={{ marginTop: 16 }}>
          Description
        </label>
        <textarea id="m-desc" className="f" rows={3} maxLength={600} value={form.description} onChange={(e) => set("description", e.target.value)} />
        <label className="l" htmlFor="m-cap" style={{ marginTop: 16 }}>
          Capabilities
        </label>
        <CapsInput id="m-cap" value={form.capabilities} onChange={(v) => set("capabilities", v)} category={form.category} />
        <div className="grid" style={{ gridTemplateColumns: mobile ? "1fr" : "1fr 1fr 1fr", gap: 16, marginTop: 8 }}>
          <div>
            <label className="l" htmlFor="m-spec">
              Specializes in
            </label>
            <input id="m-spec" className="f" maxLength={160} value={form.specialty} onChange={(e) => set("specialty", e.target.value)} />
          </div>
          <div>
            <label className="l" htmlFor="m-type">
              Task type
            </label>
            <input id="m-type" className="f" maxLength={80} value={form.taskType} onChange={(e) => set("taskType", e.target.value)} />
          </div>
          <div>
            <label className="l" htmlFor="m-out">
              Deliverable
            </label>
            <input id="m-out" className="f" list="m-out-list" maxLength={80} value={form.outputType} onChange={(e) => set("outputType", e.target.value)} />
            <datalist id="m-out-list">
              {OUTPUT_TYPES.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 16, marginTop: 16 }}>
          <div>
            <label className="l" htmlFor="m-price">
              Price per task (€)
            </label>
            <input id="m-price" className="f" type="number" min={1} max={500} inputMode="decimal" value={form.priceEuros} onChange={(e) => set("priceEuros", e.target.value)} style={{ maxWidth: 160 }} />
            <p className="hint">
              You earn {eur(Math.round(((parsePriceCents(form.priceEuros) ?? 0) * (100 - PLATFORM_FEE_PERCENT)) / 100))} per task.
            </p>
          </div>
          <div>
            <label className="l">Estimated execution time</label>
            <div className="row wrapflex" style={{ gap: 6 }}>
              {TIME_WINDOWS.map(([l, h]) => {
                const on = form.estMinutesLow === l && form.estMinutesHigh === h;
                return (
                  <button key={l} type="button" className={on ? "chip on" : "chip"} aria-pressed={on} onClick={() => setForm((f) => (f ? { ...f, estMinutesLow: l, estMinutesHigh: h } : f))}>
                    {minutesRange(l, h)}
                  </button>
                );
              })}
            </div>
            <p className="hint">Currently {minutesRange(form.estMinutesLow, form.estMinutesHigh)}.</p>
          </div>
        </div>
        <details className="det" style={{ marginTop: 16 }}>
          <summary>Replace instructions (system prompt)</summary>
          <p className="small muted" style={{ margin: "8px 0" }}>
            For security, current instructions are never sent back to the browser. Paste a full new version to replace them; leave this empty to
            keep what&apos;s running.
          </p>
          <textarea
            className="f"
            rows={10}
            aria-label="New system prompt"
            value={form.systemPrompt}
            onChange={(e) => set("systemPrompt", e.target.value)}
            spellCheck={false}
            placeholder="Paste the new system prompt…"
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 13 }}
          />
        </details>
        {formErr && (
          <div className="notice" role="alert" style={{ background: "var(--bad-soft)", color: "var(--bad)", marginTop: 14 }}>
            <Icon name="alert" />
            <span>{formErr}</span>
          </div>
        )}
        <div className="row wrapflex" style={{ marginTop: 20 }}>
          <button type="submit" className="btn p" disabled={!dirty || saving} aria-busy={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!dirty || saving}
            onClick={() => {
              setForm(toForm(a));
              setFormErr(null);
            }}
          >
            Discard
          </button>
          <span className="tiny muted">{dirty ? `${Object.keys(changes).length} unsaved ${Object.keys(changes).length === 1 ? "change" : "changes"}` : "No changes"}</span>
        </div>
      </form>

      <Modal open={confirmPause} onClose={() => setConfirmPause(false)} title={`Pause ${a.name}?`}>
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          It disappears from the marketplace and won&apos;t be matched to new work. Tasks already running finish normally. You can go live again
          any time.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => setConfirmPause(false)} data-autofocus>
            Keep it live
          </button>
          <button type="button" className="btn bad" onClick={() => setLive(false)} disabled={toggling} aria-busy={toggling}>
            <Icon name="pause" />
            Pause agent
          </button>
        </div>
      </Modal>
    </div>
  );
}
