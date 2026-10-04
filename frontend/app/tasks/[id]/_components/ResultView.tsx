"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { api, type Frequency, type Outcome, type Task, type Workflow } from "@/lib/api";
import { Avatar, Flow, Icon, OutcomeTag, Tag, useToast } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { FREQ_PER } from "@/lib/data";
import { dateTime, duration, durationBetween, eur, num, shortDate } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { cx } from "@/lib/utils";
import { Md } from "./Md";
import { RunAgainModal } from "./RunAgainModal";
import { costByStep, plain, slugify, sortedSteps, stepSeconds, words } from "./shared";
import s from "./result.module.css";

type Section = { id: string; title: string | null; md: string };

/** Split the report on `## ` headings (outside code fences); pull out a leading `# ` title. */
function splitReport(md: string): { h1: string | null; sections: Section[] } {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let h1: string | null = null;
  let fence = false;
  let cur: Section = { id: "overview", title: null, md: "" };
  const out: Section[] = [];
  const used = new Set<string>();
  const uid = (t: string) => {
    let base = "r-" + slugify(t);
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
    used.add(id);
    return id;
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (!fence) {
      const m1 = /^#\s+(.+?)\s*#*\s*$/.exec(line);
      if (m1 && h1 === null && out.length === 0 && !cur.md.trim()) {
        h1 = plain(m1[1]);
        continue;
      }
      const m2 = /^##\s+(.+?)\s*#*\s*$/.exec(line);
      if (m2) {
        if (cur.md.trim() || cur.title) out.push(cur);
        const title = plain(m2[1]);
        cur = { id: uid(title), title, md: "" };
        continue;
      }
    }
    cur.md += line + "\n";
  }
  if (cur.md.trim() || cur.title) out.push(cur);
  return { h1, sections: out };
}

const FREQS: Frequency[] = ["Weekly", "Monthly", "Quarterly"];
const MONTHLY_MULT: Record<Frequency, number> = { Weekly: 4.3, Monthly: 1, Quarterly: 1 / 3 };
const OUTCOMES: Outcome[] = ["Achieved", "Partially", "Not achieved"];

export function ResultView({ task, onTask }: { task: Task; onTask: (t: Task) => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const result = task.result ?? "";
  const { h1, sections } = useMemo(() => splitReport(result), [result]);
  const toc = sections.filter((x) => x.title);
  const steps = useMemo(() => sortedSteps(task), [task]);
  const costs = useMemo(() => costByStep(task), [task]);
  const nWords = useMemo(() => words(result), [result]);
  const estimates = useMemo(() => (result.match(/\bestimated?\b|\(est\.?\)/gi) || []).length, [result]);
  const verifier = steps.find((x) => x.role === "Verification");
  const notesSec = toc.find((x) => /source|verif|caveat|assumption|limitation/i.test(x.title ?? ""));
  const title = h1 || task.title;

  const [manualHours, setManualHours] = useState<number | null>(null);
  const [runAgain, setRunAgain] = useState(false);
  const [active, setActive] = useState<string | null>(toc[0]?.id ?? null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [fbBusy, setFbBusy] = useState<Outcome | null>(null);
  const [freq, setFreq] = useState<Frequency>("Monthly");
  const [wf, setWf] = useState<Workflow | null>(null);
  const [wfBusy, setWfBusy] = useState(false);

  // "Time saved" comes from the estimator's manual-hours figure for this brief.
  useEffect(() => {
    let live = true;
    api
      .estimateTask({ description: task.description, depth: task.depth, agentId: task.agentId ?? undefined })
      .then(({ estimate }) => live && setManualHours(estimate.manualHoursEstimate))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [task.description, task.depth, task.agentId]);

  // Highlight the TOC entry for the section in view.
  useEffect(() => {
    if (!toc.length || typeof IntersectionObserver === "undefined") return;
    const els = toc.map((x) => document.getElementById(x.id)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-90px 0px -60% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toc.map((x) => x.id).join("|")]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setActive(id);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      toast.info("Report copied as Markdown", { icon: "copy" });
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = result;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        toast.info("Report copied as Markdown", { icon: "copy" });
      } catch {
        toast.error("Couldn't copy — your browser blocked clipboard access");
      }
    }
  };

  const download = () => {
    try {
      const blob = new Blob([result], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(title)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Downloaded Markdown report");
    } catch {
      toast.error("Couldn't download the file in this browser");
    }
  };

  const printPdf = () => {
    try {
      window.print();
    } catch {
      toast.error("Printing isn't available here");
    }
  };

  const feedback = async (o: Outcome) => {
    setFbBusy(o);
    try {
      const r = await api.sendFeedback(task.id, o);
      onTask(r.task);
      toast("Thanks. Your rating feeds the Agent Performance Graph.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFbBusy(null);
    }
  };

  const activate = async () => {
    setWfBusy(true);
    try {
      const r = await api.createWorkflow({
        name: task.title,
        basedOnText: task.description,
        frequency: freq,
        depth: task.depth,
        agentId: task.agentId ?? undefined,
      });
      setWf(r.workflow);
      toast(`Workflow active: runs ${freq.toLowerCase()}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setWfBusy(false);
    }
  };

  const meta: [string, React.ReactNode][] = [
    ["Status", "Completed"],
    ["Completed in", durationBetween(task.startedAt ?? task.createdAt, task.completedAt)],
    ["Cost", eur(task.costCents)],
    ["Agents involved", steps.length],
    ["Report", `${num(nWords)} words`],
    ["Time saved", manualHours ? `~${manualHours} hours` : "—"],
  ];
  const per = FREQ_PER[freq];

  return (
    <div className={cx("wrap", s.page)}>
      <Flow step={4} />
      <div className="row between wrapflex" style={{ alignItems: "flex-start", margin: "10px 0 18px", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <span className="tag ok">
            <Icon name="check" />
            Your work is ready
          </span>
          <h1 className="serif" style={{ fontSize: "clamp(28px,4.2vw,44px)", lineHeight: 1.08, marginTop: 12, maxWidth: "24ch" }}>
            {title}
          </h1>
          <div className="muted small" style={{ marginTop: 8 }}>
            {task.agent ? <>Led by {task.agent.name} · </> : null}
            <span style={{ textTransform: "capitalize" }}>{task.depth}</span> depth · Delivered {dateTime(task.completedAt)}
          </div>
        </div>
        <div className="row wrapflex no-print">
          <button type="button" className="btn" onClick={printPdf}>
            <Icon name="dl" />
            Download PDF
          </button>
          <button type="button" className="btn" onClick={download}>
            <Icon name="file" />
            Download .md
          </button>
          <button type="button" className="btn" onClick={copy}>
            <Icon name="copy" />
            Copy
          </button>
          <button type="button" className="btn" onClick={() => setRunAgain(true)}>
            <Icon name="redo" />
            Run again
          </button>
          <Link className="btn" href={ROUTES.newTask}>
            <Icon name="plus" />
            New task
          </Link>
          <button type="button" className="btn p" onClick={() => jump("automate")}>
            <Icon name="redo" />
            Create workflow
          </button>
        </div>
      </div>

      <div className="grid g6 keep2">
        {meta.map(([k, v]) => (
          <div key={k} className="stat" style={{ padding: "12px 16px" }}>
            <span>{k}</span>
            <b style={{ fontSize: 20 }}>{v}</b>
          </div>
        ))}
      </div>

      <div className="report" style={{ marginTop: 22, ...(toc.length ? {} : { gridTemplateColumns: "1fr" }) }}>
        {toc.length > 0 && (
          <aside className="toc" aria-label="Report contents">
            <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 8, paddingLeft: 14 }}>
              Contents
            </div>
            {toc.map((x) => (
              <a
                key={x.id}
                href={`#${x.id}`}
                className={active === x.id ? s.tocOn : undefined}
                aria-current={active === x.id ? "location" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  jump(x.id);
                }}
              >
                {x.title}
              </a>
            ))}
            <a
              href="#produced"
              onClick={(e) => {
                e.preventDefault();
                jump("produced");
              }}
              style={{ marginTop: 10 }}
            >
              How this was produced
            </a>
          </aside>
        )}
        <div style={{ minWidth: 0 }}>
          <article className={cx("card", s.reportCard)} style={{ padding: "8px 28px" }} aria-label="Report">
            {sections.length === 0 ? (
              <div className="rsec">
                <p className="muted">The team finished, but the report came back empty. Run it again at no extra risk: failed runs are refunded.</p>
              </div>
            ) : (
              sections.map((sec, i) => (
                <section
                  key={sec.id}
                  id={sec.id}
                  className="rsec"
                  style={{ scrollMarginTop: 84, ...(i === sections.length - 1 ? { borderBottom: 0 } : {}) }}
                >
                  {sec.title && <h2>{sec.title}</h2>}
                  <Md>{sec.md}</Md>
                </section>
              ))
            )}
          </article>

          {/* How this was produced — the real team steps */}
          <div className="card" id="produced" style={{ marginTop: 20, scrollMarginTop: 84 }}>
            <div className="row between wrapflex" style={{ marginBottom: 12 }}>
              <h3>How this was produced</h3>
              <span className="tiny muted">
                {steps.length} {steps.length === 1 ? "agent" : "agents"} · {durationBetween(task.startedAt ?? task.createdAt, task.completedAt)} end to end
              </span>
            </div>
            <div className="plan">
              {steps.map((st, k) => {
                const isOpen = openStep === st.id;
                return (
                  <Fragment key={st.id}>
                    <div className="pstep">
                      <div className="pn">0{k + 1}</div>
                      <div className="card pcard">
                        <div className="row" style={{ gap: 12 }}>
                          <Avatar
                            name={st.agentName}
                            hue={st.agentId && st.agentId === task.agentId && task.agent ? task.agent.hue : undefined}
                            size="sm"
                          />
                          <div className="sp" style={{ minWidth: 0 }}>
                            <b>{st.agentName}</b>
                            <div className="small muted">
                              {st.role} · {st.title}
                            </div>
                          </div>
                          <span className="tag gray">{duration(stepSeconds(st))}</span>
                        </div>
                        {st.output && (
                          <div className="no-print" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                            <button
                              type="button"
                              className="btn sm ghost"
                              aria-expanded={isOpen}
                              onClick={() => setOpenStep(isOpen ? null : st.id)}
                            >
                              <Icon name={isOpen ? "up" : "down"} />
                              {isOpen ? "Hide this step's output" : "Read this step's output"}
                            </button>
                            {isOpen && (
                              <div
                                className="reveal"
                                style={{
                                  marginTop: 10,
                                  maxHeight: 420,
                                  overflow: "auto",
                                  padding: "4px 16px",
                                  border: "1px solid var(--line)",
                                  borderRadius: 10,
                                  background: "var(--surface2)",
                                }}
                              >
                                <Md small>{st.output}</Md>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {k < steps.length - 1 && <div className="pconn" />}
                  </Fragment>
                );
              })}
            </div>
          </div>

          <div className="grid g2" style={{ marginTop: 20, alignItems: "start" }}>
            <div className="stack">
              <div className="card">
                <div className="row between">
                  <h3>Verification notes</h3>
                  <Tag variant={verifier ? "ok" : "gray"}>{verifier ? "Independently checked" : "Built-in review"}</Tag>
                </div>
                <div className="kv">
                  <span>Steps completed</span>
                  <b>
                    {steps.filter((x) => x.status === "COMPLETED").length} of {steps.length}
                  </b>
                </div>
                <div className="kv">
                  <span>Verification agent</span>
                  {verifier ? <b>{verifier.agentName}</b> : <span className="small">Not included · choose Deep to add one</span>}
                </div>
                <div className="kv">
                  <span>Figures labelled as estimates</span>
                  <b>{estimates}</b>
                </div>
                <div className="kv">
                  <span>Report length</span>
                  <b>
                    {num(nWords)} words · {toc.length} sections
                  </b>
                </div>
                <p className="tiny muted" style={{ marginTop: 8 }}>
                  Every agent is instructed to label estimates and never invent citations. Check flagged items before relying on them.
                  {notesSec && (
                    <>
                      {" "}
                      <a
                        href={`#${notesSec.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          jump(notesSec.id);
                        }}
                        style={{ color: "var(--accent)", fontWeight: 600 }}
                      >
                        Read “{notesSec.title}”
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="card rcpt">
                <div className="row between wrapflex">
                  <h3>Task receipt</h3>
                  <Tag variant="warn">Demo economics</Tag>
                </div>
                <div className="kv">
                  <span>Customer paid</span>
                  <b>{eur(task.costCents)}</b>
                </div>
                {costs.steps.map(({ step: st, cents }) => (
                  <div className="kv" key={st.id}>
                    <span>
                      {st.role} · {st.agentName}
                    </span>
                    <span>{eur(cents)}</span>
                  </div>
                ))}
                <div className="kv">
                  <span>Ensemblis platform fee</span>
                  <span>{eur(costs.fee)}</span>
                </div>
                <p className="tiny muted" style={{ marginTop: 8 }}>
                  Illustrative split by step role. Developers keep 80% of task revenue. Paid with demo credits on {shortDate(task.createdAt)}.
                </p>
              </div>
            </div>
            <div className="stack no-print">
              <div className="card">
                <h3>Did this task achieve what you needed?</h3>
                <p className="small muted" style={{ marginTop: 4 }}>
                  Your answer feeds each agent&apos;s achieved rate on the Agent Performance Graph.
                </p>
                <div className="row wrapflex" style={{ margin: "12px 0" }} role="group" aria-label="Outcome">
                  {OUTCOMES.map((o) => (
                    <button
                      key={o}
                      type="button"
                      className={task.outcome === o ? "btn p" : "btn"}
                      aria-pressed={task.outcome === o}
                      aria-busy={fbBusy === o}
                      disabled={!!fbBusy}
                      onClick={() => feedback(o)}
                    >
                      {o === "Achieved" && <Icon name="check" />}
                      {o}
                    </button>
                  ))}
                </div>
                {task.outcome && (
                  <div className="tag ok reveal">
                    <Icon name="check" />
                    Thank you. You can change your answer any time.
                  </div>
                )}
                {task.outcome && task.outcome !== "Achieved" && (
                  <p className="small muted reveal" style={{ marginTop: 10 }}>
                    Want a better result? <button type="button" className="btn sm" onClick={() => setRunAgain(true)}>Run again</button>{" "}
                    or{" "}
                    <Link className="btn sm" href={`${ROUTES.newTask}?q=${encodeURIComponent(task.description)}`}>
                      re-plan with another agent
                    </Link>
                  </p>
                )}
              </div>
              <div className="card">
                <h3>Performance data</h3>
                <p className="small muted" style={{ marginBottom: 6 }}>
                  Every task feeds the Agent Performance Graph. Ensemblis learns which agents perform best for specific types of work.
                </p>
                <div className="kv">
                  <span>Task success</span>
                  <Tag variant="ok">Completed</Tag>
                </div>
                <div className="kv">
                  <span>Execution time</span>
                  <b>{durationBetween(task.startedAt ?? task.createdAt, task.completedAt)}</b>
                </div>
                <div className="kv">
                  <span>Cost</span>
                  <b>{eur(task.costCents)}</b>
                </div>
                <div className="kv">
                  <span>Your rating</span>
                  {task.outcome ? <OutcomeTag outcome={task.outcome} /> : <span className="muted">Awaiting your rating</span>}
                </div>
                <div className="kv">
                  <span>Repeat usage</span>
                  <span>{wf ? "Recurring workflow" : "Not yet"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Automate this — prototype autoCard() */}
          <div className="card no-print" id="automate" style={{ marginTop: 20, borderColor: "var(--accent)", scrollMarginTop: 84 }}>
            {wf ? (
              <div className="row wrapflex reveal" style={{ gap: 14 }}>
                <span className="tag ok">
                  <Icon name="check" />
                  Workflow active
                </span>
                <div className="sp">
                  <b>
                    Runs {wf.frequency.toLowerCase()} · {eur(task.costCents)}/{FREQ_PER[wf.frequency]}
                  </b>
                  <div className="small muted">
                    Next run {wf.nextRun ? shortDate(wf.nextRun) : "soon"}. Every run feeds this agent team&apos;s performance record.
                  </div>
                </div>
                <Link className="btn sm" href={ROUTES.workflows}>
                  View workflows
                </Link>
              </div>
            ) : (
              <div className="grid g2" style={{ gap: 24, alignItems: "center" }}>
                <div>
                  <span className="tag">Workflows</span>
                  <h3 className="serif" style={{ fontSize: 26, margin: "12px 0 6px" }}>
                    You can automate this work.
                  </h3>
                  <p className="muted small">Run this task on a schedule and get an updated report without asking again.</p>
                </div>
                <div>
                  <label className="l" htmlFor="wf-freq">
                    Frequency
                  </label>
                  <select id="wf-freq" className="f" value={freq} onChange={(e) => setFreq(e.target.value as Frequency)}>
                    {FREQS.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                  <div className="kv" style={{ marginTop: 10 }}>
                    <span>Estimated cost</span>
                    <b>
                      {eur(task.costCents)}/{per}
                      {freq === "Weekly" && ` · about ${eur(Math.round(task.costCents * MONTHLY_MULT.Weekly))}/month`}
                    </b>
                  </div>
                  {user && user.credits < task.costCents && (
                    <p className="tiny muted" style={{ marginTop: 6 }}>
                      Runs need credits: your balance is {eur(user.credits)}.
                    </p>
                  )}
                  <button type="button" className="btn p block" style={{ marginTop: 8 }} onClick={activate} aria-busy={wfBusy} disabled={wfBusy}>
                    Activate workflow
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="row wrapflex no-print" style={{ margin: "26px 0 8px", gap: 10 }}>
            <button type="button" className="btn" onClick={() => setRunAgain(true)}>
              <Icon name="redo" />
              Run again
            </button>
            <Link className="btn p" href={ROUTES.newTask}>
              <Icon name="plus" />
              New task
            </Link>
            <Link className="btn ghost" href={ROUTES.tasks}>
              Back to My work
            </Link>
          </div>
          <p className={cx("tiny muted", s.printOnly)} style={{ marginTop: 16 }}>
            Produced by Ensemblis · {task.title} · {dateTime(task.completedAt)}
          </p>
        </div>
      </div>

      <RunAgainModal task={task} open={runAgain} onClose={() => setRunAgain(false)} />
    </div>
  );
}
