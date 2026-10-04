"use client";

import { useTheme, type ThemePref } from "@/lib/theme";
import { Icon, type IconName } from "./Icon";

const OPTS: { id: ThemePref; label: string; icon: IconName }[] = [
  { id: "light", label: "Light", icon: "sun" },
  { id: "dark", label: "Dark", icon: "moon" },
  { id: "system", label: "System", icon: "monitor" },
];

/** Light / Dark / System segmented control (`.seg`). `iconsOnly` for tight spots. */
export function ThemeSwitch({ iconsOnly = false }: { iconsOnly?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <div className="seg" role="radiogroup" aria-label="Theme">
      {OPTS.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={theme === o.id}
          aria-label={iconsOnly ? o.label : undefined}
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
