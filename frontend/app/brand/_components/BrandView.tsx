"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon, Lockup, Mark, useToast } from "@/components";
import { BRAND_SWATCHES } from "@/lib/data";

const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="2" y="2" width="5" height="20" rx="2.2" fill="#0B1020"/><rect x="10" y="2" width="12" height="5" rx="2.2" fill="#5B3DF5"/><rect x="10" y="9.5" width="8" height="5" rx="2.2" fill="#0FB0CB"/><rect x="10" y="17" width="12" height="5" rx="2.2" fill="#5B3DF5"/></svg>`;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function Cell({ children, label, dk, style }: { children: ReactNode; label: string; dk?: boolean; style?: CSSProperties }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className={`bcell ${dk ? "dk" : ""}`.trim()} style={style}>
        {children}
      </div>
      <div className="tiny muted" style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
        {label}
      </div>
    </div>
  );
}

const DOS: [string, string][] = [
  ["Give the mark clear space — at least the width of its spine on every side.", "Stretch, rotate or re-space the four modules."],
  ["Use the full-color mark on navy, mist or white backgrounds.", "Place the color mark on violet or busy imagery — use the reversed mono version."],
  ["Write outcomes: “Describe the work.” “One verified result.”", "Promise to replace people, or lean on hype and superlatives."],
  ["Quote real numbers and label estimates as estimates.", "Present illustrative figures as a customer’s own data."],
];

export function BrandView() {
  const toast = useToast();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, what: string) => {
    if (await copyText(text)) {
      setCopied(text);
      toast.info(`${what} copied`, { icon: "copy" });
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1600);
    } else toast.error("Couldn't access the clipboard");
  };

  const h2: CSSProperties = { fontSize: 30, margin: "44px 0 14px" };

  return (
    <div className="wrap" style={{ paddingBottom: 48 }}>
      <div className="pagehead">
        <span className="tag">Brand</span>
        <h1 style={{ marginTop: 12, maxWidth: "16ch" }}>Individual intelligence, one outcome.</h1>
        <p>
          The Ensemblis mark is an E built from four independent modules: a spine and three bars. Separate components converging into one coordinated
          system.
        </p>
      </div>

      <div className="grid g3">
        <Cell label="Full color · light">
          <Lockup size={40} />
        </Cell>
        <Cell label="Full color · dark" dk>
          <span style={{ color: "var(--ink)" }}>
            <Lockup size={40} />
          </span>
        </Cell>
        <Cell label="Monochrome · ink">
          <span className="lockup" style={{ color: "var(--ink)", gap: 12 }}>
            <Mark size={40} mono />
            <span className="wm" style={{ fontSize: 31 }}>
              Ensemblis
            </span>
          </span>
        </Cell>
        <Cell label="Monochrome · reversed" style={{ background: "#5B3DF5" }}>
          <span className="lockup" style={{ color: "#fff", gap: 12 }}>
            <Mark size={40} mono />
            <span className="wm" style={{ fontSize: 31 }}>
              Ensemblis
            </span>
          </span>
        </Cell>
        <Cell label="App icon">
          <div className="dk" style={{ width: 92, height: 92, borderRadius: 24, display: "grid", placeItems: "center", boxShadow: "inset 0 0 0 1px var(--line2)", color: "var(--ink)" }}>
            <Mark size={52} />
          </div>
        </Cell>
        <Cell label="Favicon · 48, 32, 16">
          <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
            {[
              [48, 12, 28],
              [32, 8, 18],
              [16, 4, 10],
            ].map(([s, r, m]) => (
              <div key={s} className="dk" style={{ width: s, height: s, borderRadius: r, display: "grid", placeItems: "center", color: "var(--ink)" }}>
                <Mark size={m} />
              </div>
            ))}
          </div>
        </Cell>
      </div>
      <div className="row wrapflex" style={{ marginTop: 14 }}>
        <button type="button" className="btn sm" onClick={() => copy(MARK_SVG, "Mark SVG")}>
          <Icon name={copied === MARK_SVG ? "check" : "copy"} />
          Copy mark as SVG
        </button>
        <span className="tiny muted">Paste straight into Figma or your code.</span>
      </div>

      <h2 className="serif" style={h2}>
        Color
      </h2>
      <p className="small muted" style={{ marginTop: -6, marginBottom: 14 }}>
        Click a swatch to copy its hex value.
      </p>
      <div className="grid g6 keep2">
        {BRAND_SWATCHES.map(([name, hex]) => (
          <button
            key={hex}
            type="button"
            onClick={() => copy(hex, hex)}
            style={{ textAlign: "left", background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit", font: "inherit" }}
            aria-label={`Copy ${name} ${hex}`}
          >
            <div className="sw" style={{ background: hex, display: "grid", placeItems: "center", transition: "transform .15s" }}>
              {copied === hex && (
                <span className="tag" style={{ background: "rgba(255,255,255,.92)", color: "#0B1020" }}>
                  <Icon name="check" />
                  Copied
                </span>
              )}
            </div>
            <b className="small">{name}</b>
            <div className="tiny muted row" style={{ gap: 4 }}>
              {hex}
              <Icon name="copy" size={11} />
            </div>
          </button>
        ))}
      </div>

      <h2 className="serif" style={h2}>
        Type
      </h2>
      <div className="grid g2">
        <div className="card">
          <div className="tiny muted">Sora · display</div>
          <div style={{ fontFamily: "var(--serif)", fontWeight: 600, fontSize: 38, letterSpacing: "-.035em", lineHeight: 1.05, marginTop: 8 }}>Describe the outcome.</div>
          <div className="row wrapflex tiny muted" style={{ gap: 14, marginTop: 14 }}>
            <span>600 · headlines</span>
            <span>500 · section titles</span>
            <span>−0.02 to −0.04em tracking</span>
          </div>
        </div>
        <div className="card">
          <div className="tiny muted">Manrope · interface</div>
          <p style={{ marginTop: 8 }}>
            Ensemblis finds, coordinates, and manages the AI agents required to get the work done, then verifies the result before it reaches you.
          </p>
          <div className="row wrapflex tiny muted" style={{ gap: 14, marginTop: 14 }}>
            <span>400 · body</span>
            <span>600 · labels &amp; buttons</span>
            <span>13–19px</span>
          </div>
        </div>
      </div>

      <h2 className="serif" style={h2}>
        Voice
      </h2>
      <div className="grid g2">
        <div className="card">
          <b>We sound</b>
          <p className="muted small" style={{ marginTop: 6 }}>
            Confident, clear, precise. We describe what happens and what it costs.
          </p>
        </div>
        <div className="card">
          <b>We avoid</b>
          <p className="muted small" style={{ marginTop: 6 }}>
            Hype, superlatives, and promises of replacing people.
          </p>
        </div>
      </div>

      <h2 className="serif" style={h2}>
        Do &amp; don&apos;t
      </h2>
      <div className="tw">
        <table style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th style={{ width: "50%" }}>
                <span className="row" style={{ gap: 6, color: "var(--ok)" }}>
                  <Icon name="check" size={14} />
                  Do
                </span>
              </th>
              <th>
                <span className="row" style={{ gap: 6, color: "var(--bad)" }}>
                  <Icon name="x" size={14} />
                  Don&apos;t
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {DOS.map(([d, n]) => (
              <tr key={d}>
                <td className="small">{d}</td>
                <td className="small muted">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
