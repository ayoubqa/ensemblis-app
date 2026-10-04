"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components";
import { HOW_IT_WORKS } from "@/lib/data";
import { useInView, useReducedMotion } from "@/lib/hooks";

type Step = (typeof HOW_IT_WORKS)[number];

function Typewriter({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) {
      setN(text.length);
      return;
    }
    setN(0);
    const t = setInterval(() => setN((x) => (x >= text.length ? x : x + 1)), 28);
    return () => clearInterval(t);
  }, [text, reduced]);
  return (
    <>
      <span aria-hidden="true">{text.slice(0, n)}</span>
      <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {text}
      </span>
      <span className="caret" aria-hidden="true" />
    </>
  );
}

function Bars({ rows }: { rows: { name: string; pct: number }[] }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), 60);
    return () => clearTimeout(t);
  }, []);
  return (
    <>
      {rows.map((x) => (
        <div className="mini" key={x.name}>
          <div className="row between small">
            <b>{x.name}</b>
            <span className="muted">{x.pct}%</span>
          </div>
          <div className="progress" style={{ marginTop: 8 }} role="progressbar" aria-valuenow={x.pct} aria-valuemin={0} aria-valuemax={100} aria-label={x.name}>
            <i style={{ width: on ? `${x.pct}%` : "0%", transition: "width .9s cubic-bezier(.2,.7,.2,1)" }} />
          </div>
        </div>
      ))}
    </>
  );
}

function Visual({ v }: { v: Step["visual"] }) {
  switch (v.kind) {
    case "describe":
      return (
        <div className="mini">
          <div className="tiny muted">{v.label}</div>
          <div style={{ marginTop: 6, position: "relative" }}>
            <Typewriter text={v.text} />
          </div>
        </div>
      );
    case "match":
      return (
        <>
          {v.rows.map((r, i) => (
            <div key={r.name} className={`mrow reveal ${r.best ? "best" : ""}`} style={{ animationDelay: `${i * 90}ms` }}>
              <b>{r.name}</b>
              <span>{r.meta}</span>
            </div>
          ))}
        </>
      );
    case "execute":
      return <Bars rows={v.rows} />;
    case "verify":
      return (
        <>
          {v.rows.map((r, i) => (
            <div key={r} className="mrow reveal" style={{ animationDelay: `${i * 160}ms` }}>
              <span>{r}</span>
              <span style={{ color: "var(--ok)" }}>
                <Icon name="check" />
              </span>
            </div>
          ))}
        </>
      );
    case "deliver":
      return (
        <div className="mini">
          <div className="row between">
            <b>{v.title}</b>
            <span className="tag ok">Verified</span>
          </div>
          <div className="tiny muted" style={{ margin: "4px 0 12px" }}>
            {v.meta}
          </div>
          <div className="row wrapflex" style={{ gap: 8 }}>
            <span className="btn sm p">Download PDF</span>
            <span className="btn sm">Share</span>
            <span className="chip">{v.question}</span>
          </div>
        </div>
      );
  }
}

/** Prototype `HW()` + `howBlock()`: five tabs; auto-advances until the visitor takes over. */
export function HowItWorks() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLDivElement>({ threshold: 0.35, once: false });
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!auto || !inView || reduced) return;
    const t = setTimeout(() => setI((x) => (x + 1) % HOW_IT_WORKS.length), 5200);
    return () => clearTimeout(t);
  }, [auto, inView, reduced, i]);

  const pick = (k: number, focus = false) => {
    setAuto(false);
    setI(k);
    if (focus) tabs.current[k]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const n = HOW_IT_WORKS.length;
    if (e.key === "ArrowRight") pick((i + 1) % n, true);
    else if (e.key === "ArrowLeft") pick((i - 1 + n) % n, true);
    else if (e.key === "Home") pick(0, true);
    else if (e.key === "End") pick(n - 1, true);
    else return;
    e.preventDefault();
  };
  const h = HOW_IT_WORKS[i];

  return (
    <div ref={ref}>
      <div className="hwtabs" role="tablist" aria-label="How Ensemblis works" onKeyDown={onKey}>
        {HOW_IT_WORKS.map((x, k) => (
          <button
            key={x.title}
            ref={(el) => {
              tabs.current[k] = el;
            }}
            type="button"
            role="tab"
            id={`hw-tab-${k}`}
            aria-selected={i === k}
            aria-controls="hw-panel"
            tabIndex={i === k ? 0 : -1}
            className={i === k ? "on" : ""}
            onClick={() => pick(k)}
            style={{ position: "relative", overflow: "hidden" }}
          >
            <span className="step-n">{k + 1}</span>
            {x.title}
            {i === k && auto && inView && !reduced && (
              <span
                key={`p${i}`}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: 0,
                  bottom: 0,
                  height: 2,
                  width: "100%",
                  background: "var(--accent)",
                  transformOrigin: "left",
                  animation: "fillbar 5.2s linear both",
                }}
              />
            )}
          </button>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1.1fr", gap: 32, alignItems: "center" }} id="hwg" role="tabpanel" aria-labelledby={`hw-tab-${i}`}>
        <div key={`t${i}`} className="reveal">
          <div className="eyebrow">STEP {i + 1} OF 5</div>
          <h3 className="serif" style={{ fontSize: 30, marginBottom: 10 }}>
            {h.title}
          </h3>
          <p className="muted" style={{ maxWidth: 40 + "ch" }}>
            {h.body}
          </p>
          {i === 0 && <p className="small muted" style={{ marginTop: 12 }}>That&apos;s the only step you do.</p>}
        </div>
        <div key={`v${i}`} className="card flat reveal" style={{ minHeight: 190 }}>
          <Visual v={h.visual} />
        </div>
      </div>
    </div>
  );
}
