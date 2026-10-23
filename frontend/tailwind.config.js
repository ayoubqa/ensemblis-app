/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  // The resolved theme is always written to <html data-theme="light|dark">,
  // so `dark:` utilities work for both explicit and "system" preference.
  darkMode: ["selector", '[data-theme="dark"]'],
  // The prototype stylesheet in app/globals.css ships its own reset.
  // Tailwind's preflight would fight it (headings, lists, buttons), so it is off.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        surface2: "var(--surface2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        line2: "var(--line2)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        cyan: "var(--cyan)",
        ok: "var(--ok)",
        "ok-soft": "var(--ok-soft)",
        warn: "var(--warn)",
        "warn-soft": "var(--warn-soft)",
        bad: "var(--bad)",
        "bad-soft": "var(--bad-soft)",
      },
      fontFamily: {
        // Inter (next/font, app/fonts.ts) — one family for UI and display type.
        sans: ["var(--font-sans)"],
        serif: ["var(--display)"],
      },
      boxShadow: {
        card: "var(--shadow)",
      },
      borderColor: {
        DEFAULT: "var(--line)",
      },
      screens: {
        // Mirrors the prototype breakpoints (max-width 560 / 860).
        sm: "561px",
        md: "861px",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
