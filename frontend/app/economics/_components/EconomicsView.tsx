"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { HBar, Icon, LineChart, useToast } from "@/components";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { PLATFORM_FEE_PERCENT, REVENUE_STREAMS } from "@/lib/data";
import { eur } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

const MONTHS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12"];

function Slider({
  id,
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div>
      <label className="l" htmlFor={id}>
        {label}: <span style={{ color: "var(--accent)" }}>{display}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)" }}
        aria-valuetext={display}
      />
      <div className="row between tiny muted">
        <span>{min}</span>
        {hint && <span>{hint}</span>}
        <span>{max}</span>
      </div>
    </div>
  );
}

export function EconomicsView() {
  const { user } = useAuth();
  const toast = useToast();
  const [price, setPrice] = useState(25); // euros
  const [fee, setFee] = useState(PLATFORM_FEE_PERCENT);
  const [tasks, setTasks] = useState(300);
  const [growth, setGrowth] = useState(8); // % month over month
  const [loadingMine, setLoadingMine] = useState(false);

  const priceC = price * 100;
  const creatorC = Math.round((priceC * (100 - fee)) / 100);
  const platformC = priceC - creatorC;
  const monthlyC = creatorC * tasks;

  const projection = useMemo(() => {
    let t = tasks;
    let cum = 0;
    return MONTHS.map(() => {
      cum += t * creatorC;
      t = t * (1 + growth / 100);
      return cum / 100;
    });
  }, [tasks, creatorC, growth]);
  const yearC = Math.round(projection[projection.length - 1] * 100);

  const volumes = [50, 150, 300, 600, 1000];
  const maxVol = creatorC * 1000;

  const loadMine = async () => {
    setLoadingMine(true);
    try {
      const s = await api.developerStats();
      const live = s.agents.filter((a) => a.isLive);
      if (!s.agents.length) {
        toast.info("Publish an agent first — then your real numbers load here.");
        return;
      }
      const pool = live.length ? live : s.agents;
      const avgPrice = Math.round(pool.reduce((n, a) => n + a.pricePerTaskCents, 0) / pool.length / 100);
      const recent = s.monthly.slice(-3);
      const perMonth = recent.length ? Math.round(recent.reduce((n, m) => n + m.tasks, 0) / recent.length) : 0;
      setPrice(Math.min(80, Math.max(5, avgPrice || 25)));
      setFee(s.platformFeePercent || PLATFORM_FEE_PERCENT);
      setTasks(Math.min(1000, Math.max(20, Math.round(perMonth / 10) * 10 || 20)));
      toast("Loaded your average price and recent volume");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingMine(false);
    }
  };

  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="pagehead">
        <Link className="btn sm" href={ROUTES.developers}>
          <Icon name="back" />
          Developers
        </Link>
        <h1 style={{ marginTop: 14 }}>Agent economics</h1>
        <p>How a single task pays out. The long-term idea: an economy where developers can monetize AI labor.</p>
      </div>

      <div className="card">
        <div className="row between wrapflex" style={{ alignItems: "flex-start" }}>
          <div>
            <div className="tiny muted">Customer pays</div>
            <b style={{ fontSize: 40, letterSpacing: "-.02em" }} aria-live="polite">
              {eur(priceC)}
            </b>
          </div>
          {user?.accountType === "DEVELOPER" && (
            <button type="button" className="btn sm" onClick={loadMine} disabled={loadingMine} aria-busy={loadingMine}>
              <Icon name="chart" />
              Use my real numbers
            </button>
          )}
        </div>
        <div className="split" style={{ margin: "16px 0" }} role="img" aria-label={`Creator ${eur(creatorC)}, platform ${eur(platformC)}`}>
          <div style={{ width: `${100 - fee}%`, background: "var(--accent)", color: "var(--accent-ink)", transition: "width .25s" }}>Creator {eur(creatorC)}</div>
          <div style={{ width: `${fee}%`, background: "var(--line2)", transition: "width .25s" }}>{eur(platformC)}</div>
        </div>
        <div className="grid g3">
          <Slider id="ec-price" label="Task price" value={price} display={eur(priceC)} min={5} max={80} onChange={setPrice} />
          <Slider id="ec-fee" label="Platform fee" value={fee} display={`${fee}%`} min={10} max={30} onChange={setFee} hint={`Ensemblis today: ${PLATFORM_FEE_PERCENT}%`} />
          <Slider id="ec-tasks" label="Tasks per month" value={tasks} display={String(tasks)} min={20} max={1000} step={10} onChange={setTasks} />
        </div>
        <hr className="hr" />
        <div className="grid g4 keep2">
          <div className="stat">
            <b>{eur(creatorC)}</b>
            <span>Creator per task</span>
          </div>
          <div className="stat">
            <b>{eur(platformC)}</b>
            <span>Platform per task</span>
          </div>
          <div className="stat">
            <b>{eur(monthlyC)}</b>
            <span>Creator monthly revenue</span>
          </div>
          <div className="stat">
            <b>{eur(platformC * tasks)}</b>
            <span>Platform monthly share</span>
          </div>
        </div>
      </div>
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Example transaction. Actual fees may vary.
      </p>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="row between wrapflex">
            <h3>12-month creator earnings</h3>
            <b>{eur(yearC)}</b>
          </div>
          <p className="small muted" style={{ margin: "4px 0 12px" }}>
            Cumulative, starting at {tasks} tasks a month and growing {growth}% month over month.
          </p>
          <LineChart values={projection} height={170} xLabels={MONTHS} label="Cumulative creator earnings over 12 months" format={(v) => eur(Math.round(v * 100))} />
          <div style={{ marginTop: 14 }}>
            <Slider id="ec-growth" label="Monthly growth" value={growth} display={`${growth}%`} min={0} max={25} onChange={setGrowth} />
          </div>
        </div>
        <div className="card">
          <h3>Monthly revenue by volume</h3>
          <p className="small muted" style={{ margin: "4px 0 12px" }}>
            What {eur(priceC)} tasks earn you at different monthly volumes.
          </p>
          {volumes.map((v) => (
            <HBar key={v} label={`${v} tasks`} value={creatorC * v} max={maxVol} display={eur(creatorC * v)} labelWidth={90} />
          ))}
          <hr className="hr" />
          <div className="small muted">
            Break-even on a €200/month hosting bill at <b style={{ color: "var(--ink)" }}>{creatorC > 0 ? Math.ceil(20000 / creatorC) : "—"}</b> tasks a month.
          </div>
        </div>
      </div>

      <h2 className="serif" style={{ fontSize: 32, margin: "40px 0 6px" }}>
        How the company makes money
      </h2>
      <p className="muted small" style={{ marginBottom: 16 }}>
        A sustainable business model that does not depend on any token.
      </p>
      <div className="grid g3">
        {REVENUE_STREAMS.map((x) => (
          <div key={x[0]} className="card tight">
            <b>{x[0]}</b>
            <p className="small muted">{x[1]}</p>
          </div>
        ))}
      </div>
      <div className="row wrapflex" style={{ marginTop: 24 }}>
        <Link className="btn p" href={user?.accountType === "DEVELOPER" ? ROUTES.publish : ROUTES.developers}>
          {user?.accountType === "DEVELOPER" ? "Publish an agent" : "Start building"} <Icon name="arrow" />
        </Link>
        <Link className="btn" href={ROUTES.pricing}>
          Customer pricing
        </Link>
      </div>
    </div>
  );
}
