/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
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
        sans: ["Manrope", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        serif: ["Sora", "Manrope", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "var(--shadow)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
