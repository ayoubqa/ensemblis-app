"use client";

import { useRef, type KeyboardEvent } from "react";
import { useTheme, type ThemePref } from "@/lib/theme";
import { Icon, type IconName } from "./Icon";

const OPTS: { id: ThemePref; label: string; icon: IconName }[] = [
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
  { id: "system", label: "System", icon: "monitor" },
];

/**
 * Light / Dark / System segmented control (`.seg`), following the ARIA radio-group
 * pattern: one Tab stop (the checked option), arrow keys move and select.
 * `iconsOnly` for tight spots (the account menu). `horizontalOnly` when it sits inside a
 * panel that owns ↑/↓/Home/End (the account menu): only ←/→ change the theme, and the
 * other keys bubble so the panel moves focus without switching the theme.
 */
export function ThemeSwitch({ iconsOnly = false, horizontalOnly = false }: { iconsOnly?: boolean; horizontalOnly?: boolean }) {
  const { theme, setTheme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const current = Math.max(0, OPTS.findIndex((o) => o.id === theme));

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    let n = -1;
    if (e.key === "ArrowRight" || (!horizontalOnly && e.key === "ArrowDown")) n = (current + 1) % OPTS.length;
    else if (e.key === "ArrowLeft" || (!horizontalOnly && e.key === "ArrowUp")) n = (current - 1 + OPTS.length) % OPTS.length;
    else if (!horizontalOnly && e.key === "Home") n = 0;
    else if (!horizontalOnly && e.key === "End") n = OPTS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    e.stopPropagation();
    setTheme(OPTS[n].id);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[n]?.focus();
  };

  return (
    <div className={iconsOnly ? "seg sh-seg icons" : "seg sh-seg"} role="radiogroup" aria-label="Theme" ref={ref} onKeyDown={onKey}>
      {OPTS.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={theme === o.id}
          aria-label={iconsOnly ? o.label : undefined}
          tabIndex={i === current ? 0 : -1}
          title={o.label}
          onClick={() => setTheme(o.id)}
        >
          <Icon name={o.icon} />
          {!iconsOnly && o.label}
        </button>
      ))}
    </div>
  );
}

export default ThemeSwitch;
