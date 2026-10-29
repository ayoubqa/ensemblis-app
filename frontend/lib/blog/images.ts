// Intrinsic sizes for article images stored under /public, so the browser reserves their space before they
// load (no layout shift). Reads the file header only for PNG and SVG — the formats articles use; anything
// else (or a remote image) renders without dimensions and content.spec.ts warns about it.
import fs from "node:fs";
import path from "node:path";

export interface ImageSize {
  width: number;
  height: number;
}

const PUBLIC = path.join(process.cwd(), "public");
const cache = new Map<string, ImageSize | null>();

const num = (v: string | undefined) => {
  const n = v === undefined ? NaN : Number.parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function svgSize(text: string): ImageSize | null {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
  const width = num(attr("width"));
  const height = num(attr("height"));
  if (width && height && !/%/.test(attr("width") ?? "")) return { width: Math.round(width), height: Math.round(height) };
  const vb = attr("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (vb?.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: Math.round(vb[2]), height: Math.round(vb[3]) };
  return null;
}

function pngSize(buf: Buffer): ImageSize | null {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length < 24 || PNG.some((b, i) => buf[i] !== b)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** The intrinsic size of a site image ("/blog/…/figure.svg"), or null when it is remote, missing or unsupported. */
export function localImageSize(src: string): ImageSize | null {
  if (!src.startsWith("/") || src.startsWith("//")) return null;
  if (cache.has(src)) return cache.get(src) ?? null;
  let size: ImageSize | null = null;
  try {
    const file = path.join(PUBLIC, decodeURIComponent(src.split(/[?#]/)[0]));
    if (file.startsWith(PUBLIC + path.sep)) {
      const buf = fs.readFileSync(file);
      size = /\.svg$/i.test(file) ? svgSize(buf.toString("utf8")) : pngSize(buf);
    }
  } catch {
    size = null;
  }
  cache.set(src, size);
  return size;
}
