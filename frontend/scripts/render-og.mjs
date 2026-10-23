// Renders the Open Graph / X preview (public/brand/og-image.png, 1200×630) from HTML with
// the official mark and Inter, using Playwright's Chromium. Re-run after copy changes:
//   node scripts/render-og.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const b64 = (p) => readFileSync(join(root, p)).toString("base64");
const font = b64("node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");
const mark = b64("public/brand/ensemblis-mark-384.png");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:100 900}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;font-family:Inter,sans-serif;background:#07111F;color:#F6F8FB;position:relative;overflow:hidden}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(183,195,209,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(183,195,209,.07) 1px,transparent 1px);background-size:60px 60px;-webkit-mask-image:radial-gradient(80% 90% at 75% 40%,#000,transparent 75%)}
.glow{position:absolute;width:820px;height:820px;right:-200px;top:-260px;background:radial-gradient(closest-side,rgba(43,140,255,.30),rgba(22,119,255,0))}
.in{position:absolute;inset:72px 80px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:18px}
.brand img{width:76px;height:76px}
.wm{font-weight:650;font-size:26px;letter-spacing:.2em}
.eyebrow{margin-top:70px;font-size:20px;font-weight:600;letter-spacing:.16em;color:#2B8CFF;text-transform:uppercase}
h1{margin-top:18px;font-size:78px;line-height:1.04;letter-spacing:-.035em;font-weight:700}
h1 span{color:#2B8CFF}
.loop{position:absolute;left:0;right:0;bottom:0;display:flex;gap:14px;align-items:center;font-size:19px;color:#A3B1C2;font-weight:500}
.loop i{width:26px;height:1.5px;background:#233552;display:block}
.loop b{color:#F6F8FB;font-weight:600}
</style></head><body><div class="grid"></div><div class="glow"></div>
<div class="in">
  <div class="brand"><img src="data:image/png;base64,${mark}" alt=""><span class="wm">ENSEMBLIS</span></div>
  <div class="eyebrow">The AI operating layer for business</div>
  <h1>Describe the outcome.<br><span>We do the work.</span></h1>
  <div class="loop"><b>Objective</b><i></i>Plan<i></i>Approve<i></i>Execute<i></i>Verify<i></i><b>Outcome</b></div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: "png" });
writeFileSync(join(root, "public/brand/og-image.png"), png);
await browser.close();
console.log("wrote public/brand/og-image.png", png.length, "bytes");
