import localFont from "next/font/local";

// Inter (variable, latin subset — includes € and Western European accents), self-hosted from @fontsource-variable/inter (SIL OFL 1.1).
// next/font serves it from our own origin with a metric-matched fallback, so text
// never waits on a third-party stylesheet and swapping in the font doesn't shift layout.
export const inter = localFont({
  src: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
});
