"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HBar, Icon, LineChart, Modal, useToast } from "@/components";
import { api, type Agent } from "@/lib/api";
import { eur, num, pct } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { seeded } from "@/lib/utils";

type DisputeState = "open" | "Refunded" | "Agent upheld";
type ReviewState = "review" | "approved" | "rejected";

// Prototype STATE: S.disp / S.pend (amounts in whole euros there → cents here).
const DISPUTES: { id: number; t: string; a: string; amt: number; st: DisputeState }[] = [
  { id: 1, t: "Lead list had 31% invalid emails", a: "Lead Generation Agent", amt: 2900, st: "open" },
  { id: 2, t: "Report missing requested sources", a: "Research Analyst AI", amt: 1900, st: "open" },
  { id: 3, t: "Deck exceeded agreed slide count", a: "Presentation Builder", amt: 1800, st: "open" },
];
const PENDING: { id: number; n: string; c: string; st: ReviewState }[] = [
  { id: 1, n: "Patent Landscape Agent", c: "Claim & Co", st: "review" },
  { id: 2, n: "Grant Writer Pro", c: "Fundwell", st: "review" },
];
const KPIS: [string, string][] = [
  ["€184,240", "GMV"],
  ["€36,848", "Platform revenue"],
  ["842", "Active agents"],
  ["18,421", "Tasks completed"],
  ["95.7%", "Success rate"],
  ["€10.00", "Average task value"],
  ["12,906", "Total users"],
  ["4,318", "Active users (30d)"],
];
const BY_CAT: [string, number][] = [
  ["Research", 31],
  ["Marketing", 22],
  ["Sales", 18],
  ["Data", 12],
  ["Finance", 9],
  ["Other", 8],
];
const DAYS = Array.from({ length: 14 }, (_, i) => (i === 13 ? "Today" : `${13 - i}d ago`));

export function AdminView() {
  const toast = useToast();
  const gmv = useMemo(() => seeded(7, 14, 9000, 5000).map(Math.round), []);
  const [disp, setDisp] = useState(DISPUTES);
  const [pend, setPend] = useState(PENDING);
  const [confirm, setConfirm] = useState<{ id: number; r: DisputeState } | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentErr, setAgentErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .listAgents({ sort: "tasks" })
      .then((r) => setAgents(r.agents.slice(0, 6)))
      .catch((e: Error) => setAgentErr(e.message));
  }, []);

  const open = disp.filter((d) => d.st === "open").length;
  const target = confirm ? disp.find((d) => d.id === confirm.id) : null;

  const resolve = () => {
    if (!confirm) return;
    const prev = disp;
    setDisp((xs) => xs.map((x) => (x.id === confirm.id ? { ...x, st: confirm.r } : x)));
    toast(`Dispute resolved: ${confirm.r}`, { action: { label: "Undo", onClick: () => setDisp(prev) } });
    setConfirm(null);
  };
  const review = (id: number, st: ReviewState) => {
    const prev = pend;
    setPend((xs) => xs.map((x) => (x.id === id ? { ...x, st } : x)));
    toast(`Agent ${st}`, { action: { label: "Undo", onClick: () => setPend(prev) } });
  };

  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="pagehead row between wrapflex">
        <div>
          <span className="tag gray">Admin console</span>
          <h1 style={{ marginTop: 12 }}>Marketplace overview</h1>
        </div>
        <span className="tag warn" title="Actions on this page only change this demo view">
          <Icon name="info" />
          Demo console
        </span>
      </div>
      <div className="notice" style={{ marginBottom: 16, background: "var(--surface2)", color: "var(--muted)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
        <Icon name="info" />
        <span>
          A showcase of the operations console. Marketplace figures, disputes and reviews are illustrative and reset on reload; the agent table reads the live
          catalog.
        </span>
      </div>

      <div className="grid g4 keep2">
        {KPIS.map((x) => (
          <div className="stat" key={x[1]}>
            <b>{x[0]}</b>
            <span>{x[1]}</span>
          </div>
        ))}
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="row between">
            <h3>GMV, last 14 days</h3>
            <span className="tiny muted">{eur(gmv.reduce((n, v) => n + v, 0) * 100)} total</span>
          </div>
          <LineChart values={gmv} label="GMV over the last 14 days" xLabels={DAYS} format={(v) => eur(v * 100)} />
        </div>
        <div className="card">
          <h3>Tasks by category</h3>
          {BY_CAT.map((x) => (
            <HBar key={x[0]} label={x[0]} value={x[1]} max={33} display={`${x[1]}%`} labelWidth={100} />
          ))}
        </div>
      </div>

      <h3 style={{ margin: "26px 0 10px" }}>Agent performance</h3>
      {agentErr ? (
        <div className="notice" role="alert">
          <Icon name="alert" />
          <span>{agentErr}</span>
        </div>
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Tasks</th>
                <th>Success</th>
                <th>Rating</th>
                <th title="Illustrative">Disputes*</th>
                <th>GMV</th>
              </tr>
            </thead>
            <tbody>
              {agents
                ? agents.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <Link href={ROUTES.agent(a.slug)}>
                          <b>{a.name}</b>
                        </Link>
                      </td>
                      <td>{num(a.tasksCompleted)}</td>
                      <td>{pct(a.successRate)}</td>
                      <td>{a.rating > 0 ? a.rating.toFixed(1) : "—"}</td>
                      <td>{Math.round((100 - a.successRate) * 1.4)}</td>
                      <td>{eur(a.tasksCompleted * a.pricePerTaskCents)}</td>
                    </tr>
                  ))
                : [0, 1, 2, 3, 4, 5].map((k) => (
                    <tr key={k}>
                      {[0, 1, 2, 3, 4, 5].map((c) => (
                        <td key={c}>
                          <div className="sk" style={{ height: 12, width: c === 0 ? 160 : 50 }} />
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 6 }}>
        * Dispute counts are illustrative. GMV is tasks × typical price.
      </p>

      <div className="grid g2" style={{ marginTop: 26 }}>
        <div>
          <h3 style={{ marginBottom: 10 }}>Disputes ({open} open)</h3>
          <div className="stack">
            {disp.map((d) => (
              <div className="card tight" key={d.id}>
                <div className="row between" style={{ gap: 10 }}>
                  <b className="small">{d.t}</b>
                  <span className={`tag ${d.st === "open" ? "warn" : "ok"}`}>{d.st === "open" ? "Open" : d.st}</span>
                </div>
                <div className="tiny muted">
                  {d.a} · {eur(d.amt)}
                </div>
                {d.st === "open" && (
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <button type="button" className="btn sm" onClick={() => setConfirm({ id: d.id, r: "Refunded" })}>
                      Refund customer
                    </button>
                    <button type="button" className="btn sm" onClick={() => setConfirm({ id: d.id, r: "Agent upheld" })}>
                      Uphold agent
                    </button>
                  </div>
                )}
              </div>
            ))}
            {open === 0 && <p className="small muted">All disputes resolved.</p>}
          </div>
        </div>
        <div>
          <h3 style={{ marginBottom: 10 }}>Agents awaiting review</h3>
          <div className="stack">
            {pend.map((p) => (
              <div className="card tight" key={p.id}>
                <div className="row between">
                  <div>
                    <b className="small">{p.n}</b>
                    <div className="tiny muted">{p.c}</div>
                  </div>
                  <span className={`tag ${p.st === "review" ? "warn" : p.st === "approved" ? "ok" : "bad"}`}>
                    {p.st === "review" ? "In review" : p.st === "approved" ? "Approved" : "Rejected"}
                  </span>
                </div>
                {p.st === "review" && (
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <button type="button" className="btn sm p" onClick={() => review(p.id, "approved")}>
                      Approve
                    </button>
                    <button type="button" className="btn sm" onClick={() => review(p.id, "rejected")}>
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.r === "Refunded" ? "Refund the customer?" : "Uphold the agent?"}>
        <p className="muted small" style={{ margin: "6px 0 16px" }}>
          {confirm?.r === "Refunded"
            ? `${eur(target?.amt ?? 0)} goes back to the customer and the task counts against ${target?.a}.`
            : `The charge stands and the dispute closes in ${target?.a}'s favour.`}{" "}
          This is a demo — nothing real changes.
        </p>
        <div className="row">
          <button type="button" className="btn" onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button type="button" className={`btn ${confirm?.r === "Refunded" ? "bad" : "p"}`} onClick={resolve} data-autofocus>
            {confirm?.r === "Refunded" ? "Refund customer" : "Uphold agent"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
