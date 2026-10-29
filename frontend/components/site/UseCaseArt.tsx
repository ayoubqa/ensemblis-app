// Small drawings of what each team's work delivers — a positioning map, account briefs, scenarios, a process
// with its bottleneck. Illustrations of the deliverable's shape, not screenshots and not data: the shapes are
// generic and carry no numbers. Inline SVG so they follow the page's theme; decorative (the text beside them
// says what each delivers).

const S = { fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Marketing() {
  // A positioning map: competitors as dots, one opening ringed, two evidence tags.
  const dots: [number, number][] = [
    [62, 34],
    [92, 52],
    [74, 78],
    [146, 30],
    [168, 86],
    [118, 96],
  ];
  return (
    <>
      <path d="M20 66 H220 M120 12 V120" stroke="var(--line2)" strokeWidth="1.5" {...S} />
      <path d="M20 12 H220 V120 H20 Z" stroke="var(--line)" strokeWidth="1" {...S} />
      {dots.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="var(--line2)" />
      ))}
      <circle cx="190" cy="40" r="15" stroke="var(--accent)" strokeOpacity="0.35" strokeWidth="1.5" {...S} />
      <circle cx="190" cy="40" r="7" fill="var(--accent)" />
      <rect x="146" y="50" width="26" height="16" rx="4" stroke="var(--accent)" strokeOpacity="0.6" strokeWidth="1.2" {...S} />
      <text x="159" y="62" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--accent)" fontFamily="var(--mono)">
        [2]
      </text>
      <rect x="58" y="96" width="26" height="16" rx="4" stroke="var(--accent)" strokeOpacity="0.6" strokeWidth="1.2" {...S} />
      <text x="71" y="108" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--accent)" fontFamily="var(--mono)">
        [1]
      </text>
    </>
  );
}

function Sales() {
  // Three account briefs, the front one with a fit bar and a conversation angle.
  return (
    <>
      <rect x="64" y="10" width="140" height="80" rx="8" fill="var(--surface2)" stroke="var(--line)" strokeWidth="1" />
      <rect x="48" y="22" width="140" height="84" rx="8" fill="var(--surface2)" stroke="var(--line2)" strokeWidth="1" />
      <rect x="30" y="34" width="150" height="88" rx="9" fill="var(--surface)" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="1.5" />
      <circle cx="50" cy="54" r="9" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M66 50 H132 M66 60 H112" stroke="var(--line2)" strokeWidth="4" {...S} />
      <path d="M44 80 H160" stroke="var(--line)" strokeWidth="6" {...S} />
      <path d="M44 80 H128" stroke="var(--ok)" strokeWidth="6" {...S} />
      <path d="M44 100 L52 108 L66 94" stroke="var(--accent)" strokeWidth="2.2" {...S} />
      <path d="M74 102 H150" stroke="var(--line2)" strokeWidth="4" {...S} />
    </>
  );
}

function Finance() {
  // Base, upside and downside scenarios fanning out from today.
  return (
    <>
      <path d="M20 112 H220" stroke="var(--line2)" strokeWidth="1.5" {...S} />
      <path d="M20 12 V112" stroke="var(--line)" strokeWidth="1" {...S} />
      <path d="M20 86 C50 84 66 76 90 72" stroke="var(--muted)" strokeWidth="2.2" {...S} />
      <path d="M90 72 C130 60 170 30 214 20" stroke="var(--ok)" strokeWidth="2.2" strokeDasharray="5 5" {...S} />
      <path d="M90 72 C130 66 170 56 214 50" stroke="var(--accent)" strokeWidth="2.8" {...S} />
      <path d="M90 72 C130 78 170 90 214 98" stroke="var(--warn)" strokeWidth="2.2" strokeDasharray="5 5" {...S} />
      <circle cx="90" cy="72" r="5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
      <path d="M90 16 V108" stroke="var(--line2)" strokeWidth="1" strokeDasharray="2 4" {...S} />
    </>
  );
}

function Operations() {
  // A process: five steps, one bottleneck flagged, and the improved route around it.
  const xs = [28, 74, 120, 166, 212];
  return (
    <>
      <path d="M28 70 H212" stroke="var(--line2)" strokeWidth="2" {...S} />
      <path d="M74 70 V36 H166 V70" stroke="var(--accent)" strokeWidth="2.2" strokeDasharray="5 5" {...S} />
      {xs.map((x, i) => (
        <rect
          key={x}
          x={x - 13}
          y="57"
          width="26"
          height="26"
          rx="6"
          fill="var(--surface)"
          stroke={i === 2 ? "var(--warn)" : "var(--line2)"}
          strokeWidth={i === 2 ? 2.2 : 1.5}
        />
      ))}
      <circle cx="120" cy="70" r="20" stroke="var(--warn)" strokeOpacity="0.35" strokeWidth="1.5" {...S} />
      <path d="M120 64 V71 M120 76 V76.5" stroke="var(--warn)" strokeWidth="2.6" {...S} />
      <path d="M212 70 m-5 0 l3.5 3.5 l6.5 -7" stroke="var(--ok)" strokeWidth="2.4" {...S} />
      <path d="M20 104 H220" stroke="var(--line)" strokeWidth="1" {...S} />
    </>
  );
}

const ART = { marketing: Marketing, sales: Sales, finance: Finance, operations: Operations } as const;

export function UseCaseArt({ team, className = "" }: { team: keyof typeof ART; className?: string }) {
  const Art = ART[team];
  return (
    <svg className={`st-uc-art ${className}`} viewBox="0 0 240 130" aria-hidden="true" focusable="false">
      <Art />
    </svg>
  );
}
