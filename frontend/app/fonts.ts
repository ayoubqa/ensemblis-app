import localFont from "next/font/local";

// Schibsted Grotesk (variable, latin; SIL OFL 1.1), self-hosted from @fontsource-variable/schibsted-grotesk:
// the interface and headline face. A plain-spoken grotesk drawn for a news publisher: authoritative when set
// tight and heavy at display sizes, open at text sizes. next/font serves it from our own origin with a
// metric-matched fallback, so text never waits on a third-party stylesheet and the swap doesn't shift layout.
export const sans = localFont({
  src: "../node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2",
  weight: "400 900",
  style: "normal",
  variable: "--font-sans-face",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
});

// Newsreader (variable, latin; SIL OFL 1.1), self-hosted from @fontsource-variable/newsreader: the document
// voice. Briefs, quoted objectives and long-form reading on the blog. Not preloaded: the headline face is what
// the first paint needs, and the two Newsreader files (about 120 KB) would compete with it.
export const newsreader = localFont({
  src: [
    { path: "../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2", weight: "200 800", style: "normal" },
    { path: "../node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-italic.woff2", weight: "200 800", style: "italic" },
  ],
  variable: "--font-newsreader",
  display: "swap",
  preload: false,
  fallback: ["Georgia", "Cambria", "Times New Roman", "serif"],
});

// Inter (variable, latin; SIL OFL 1.1): only for the wordmark, which the official reference sheet sets in Inter
// (public/brand/README.md). Not preloaded: it is one short word, and its metric-matched fallback holds the space.
export const wordmark = localFont({
  src: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
  preload: false,
  fallback: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"],
});
