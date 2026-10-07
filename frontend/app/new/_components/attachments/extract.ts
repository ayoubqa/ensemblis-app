// In-browser text extraction for task attachments. Heavy parsers (pdf.js,
// mammoth, read-excel-file, papaparse) are loaded with dynamic import() the
// first time a file of that type is added — never in the initial bundle.
// Only the extracted text ever leaves the browser.
//
// The pure helpers (normalizeText, clampText, rowsToText, csvToText,
// pdfToText, docxToText, decodeText) take their parser as an argument so they
// can be exercised outside the browser.

import type { AttachmentKind } from "@/lib/api";

export type FileKind = Exclude<AttachmentKind, "url">;

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Spreadsheet/CSV rows read at most (per file). */
export const MAX_ROWS = 5000;
/** Spreadsheet tabs read at most. */
export const MAX_SHEETS = 5;
/** PDF pages read at most. */
export const MAX_PDF_PAGES = 500;

/** <input accept> value. Extensions first so every OS file picker filters correctly. */
export const ACCEPT = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".csv",
  ".txt",
  ".md",
  ".markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "text/markdown",
].join(",");

export const KIND_LABEL: Record<AttachmentKind, string> = {
  pdf: "PDF",
  docx: "Word document",
  xlsx: "Excel spreadsheet",
  csv: "CSV file",
  txt: "Text file",
  md: "Markdown file",
  url: "Web page",
};

const BY_EXT: Record<string, FileKind> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  csv: "csv",
  txt: "txt",
  text: "txt",
  md: "md",
  markdown: "md",
};

const BY_MIME: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
};

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** The attachment kind for a file, or null when we can't read it. Extension wins over MIME (MIME is often empty or generic). */
export function detectKind(name: string, mime: string): FileKind | null {
  const byExt = BY_EXT[extOf(name)];
  if (byExt) return byExt;
  if (extOf(name)) return null; // a known-but-unsupported extension: don't trust a generic MIME
  return BY_MIME[(mime || "").toLowerCase()] ?? null;
}

/** A friendly reason why a file type isn't supported, with a way forward. */
export function unsupportedReason(name: string): string {
  const ext = extOf(name);
  const fix: Record<string, string> = {
    doc: "Old Word (.doc) files can't be read here. Save it as .docx or PDF and try again.",
    xls: "Old Excel (.xls) files can't be read here. Save it as .xlsx or CSV and try again.",
    xlsm: "Macro-enabled workbooks can't be read here. Save it as .xlsx or CSV and try again.",
    ppt: "Presentations aren't supported yet. Export it as a PDF and attach that instead.",
    pptx: "Presentations aren't supported yet. Export it as a PDF and attach that instead.",
    key: "Keynote files aren't supported. Export it as a PDF and attach that instead.",
    pages: "Pages files aren't supported. Export it as a PDF or .docx and attach that instead.",
    numbers: "Numbers files aren't supported. Export it as .xlsx or CSV and attach that instead.",
    rtf: "RTF files aren't supported. Save it as .docx, PDF or plain text instead.",
    odt: "OpenDocument files aren't supported. Save it as .docx or PDF instead.",
    ods: "OpenDocument spreadsheets aren't supported. Save it as .xlsx or CSV instead.",
    zip: "Archives can't be attached. Attach the documents inside it instead.",
    json: "JSON files aren't supported. Save the data as CSV or paste the relevant part into your brief.",
    html: "Web pages are attached as links. Paste the page's address in “Add a link” instead.",
    htm: "Web pages are attached as links. Paste the page's address in “Add a link” instead.",
  };
  if (fix[ext]) return fix[ext];
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "svg", "bmp", "tif", "tiff"].includes(ext))
    return "Images can't be read yet — agents work from text. Attach a PDF or document instead.";
  if (["mp3", "wav", "m4a", "mp4", "mov", "avi", "webm"].includes(ext)) return "Audio and video files can't be read. Attach a transcript instead.";
  return "This file type isn't supported. Use PDF, Word (.docx), Excel (.xlsx), CSV, TXT or Markdown.";
}

export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractError";
  }
}

export interface ExtractProgress {
  /** "Reading…", "Reading pages", "Reading sheet" */
  label: string;
  done?: number;
  total?: number;
  /** "pages" | "sheets" */
  unit?: string;
}

export interface ExtractResult {
  /** Normalized text, at most maxChars long. */
  text: string;
  /** True when content was cut to fit maxChars (or a row/page/sheet cap). */
  truncated: boolean;
  /** Extra detail for the UI, e.g. "Read 7 of 40 pages". */
  note: string | null;
}

// ---------------------------------------------------------------- pure helpers

/** Clean up extracted text: unify line endings, drop control chars, trim line ends, collapse blank runs. */
export function normalizeText(s: string): string {
  return (
    s
      .replace(/\r\n?/g, "\n")
      .replace(/ /g, " ")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f﻿￾]/g, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Cut to at most `max` chars, preferring a line or word boundary near the end. */
export function clampText(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  let cut = s.slice(0, max);
  const floor = Math.floor(max * 0.9);
  const nl = cut.lastIndexOf("\n");
  const sp = cut.lastIndexOf(" ");
  if (nl >= floor) cut = cut.slice(0, nl);
  else if (sp >= floor) cut = cut.slice(0, sp);
  return { text: cut.trimEnd(), truncated: true };
}

/** Decode bytes as text: UTF-16 by BOM, strict UTF-8, else Windows-1252 (old Excel CSV exports). */
export function decodeText(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    try {
      return new TextDecoder("windows-1252").decode(b);
    } catch {
      return new TextDecoder("utf-8").decode(b);
    }
  }
}

/** True when decoded "text" is really binary (NULs or lots of replacement chars). */
export function looksBinary(s: string): boolean {
  const sample = s.slice(0, 8000);
  if (!sample) return false;
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0xfffd || (c < 32 && c !== 9 && c !== 10 && c !== 13)) bad++;
  }
  // A stray control char is fine; a real binary file has lots of them.
  return bad > 2 && bad / sample.length > 0.05;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return "";
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 16).replace("T", " ");
  }
  if (typeof v === "number") {
    if (!isFinite(v)) return "";
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12)));
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v).replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * Rows → readable "col | col" lines. Empty rows are skipped, trailing empty
 * cells dropped. Stops at `maxRows` rows or once `maxChars` is reached.
 */
export function rowsToText(
  rows: unknown[][],
  opts: { maxChars: number; maxRows?: number }
): { text: string; truncated: boolean; rowsUsed: number; rowsTotal: number } {
  const maxRows = opts.maxRows ?? MAX_ROWS;
  const out: string[] = [];
  let len = 0;
  let used = 0;
  let total = 0;
  let truncated = false;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const cells = row.map(cellText);
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    if (!cells.some(Boolean)) continue;
    total++;
    if (truncated) continue;
    if (used >= maxRows || len >= opts.maxChars) {
      truncated = true;
      continue;
    }
    const line = cells.join(" | ");
    out.push(line);
    len += line.length + 1;
    used++;
  }
  const clamped = clampText(out.join("\n"), opts.maxChars);
  return { text: clamped.text, truncated: truncated || clamped.truncated, rowsUsed: used, rowsTotal: total };
}

type PapaLike = {
  parse: (input: string, config: { skipEmptyLines?: boolean | "greedy"; delimiter?: string }) => { data: unknown[] };
};

/** CSV text → "col | col" lines (Papa Parse auto-detects the delimiter). */
export function csvToText(Papa: PapaLike, raw: string, maxChars: number): ExtractResult {
  let src = raw.replace(/^﻿/, "");
  // Only parse what can possibly fit: a generous slice, cut at a line end.
  const budget = Math.max(maxChars * 3, 200_000);
  let sliced = false;
  if (src.length > budget) {
    const nl = src.lastIndexOf("\n", budget);
    src = src.slice(0, nl > 0 ? nl : budget);
    sliced = true;
  }
  const parsed = Papa.parse(src, { skipEmptyLines: "greedy" });
  const rows = (parsed.data || []).filter(Array.isArray) as unknown[][];
  if (sliced && rows.length > 1) rows.pop(); // the cut may have split the last row
  const r = rowsToText(rows, { maxChars });
  if (!r.text) throw new ExtractError("This CSV file looks empty.");
  const truncated = r.truncated || sliced;
  return {
    text: r.text,
    truncated,
    note: truncated ? `First ${r.rowsUsed.toLocaleString("en")} rows` : `${r.rowsUsed.toLocaleString("en")} rows`,
  };
}

/** Plain text / Markdown. */
export function plainToText(raw: string, maxChars: number): ExtractResult {
  if (looksBinary(raw)) throw new ExtractError("This doesn't look like a text file. Check the file and try again.");
  const text = normalizeText(raw);
  if (!text) throw new ExtractError("This file is empty.");
  const c = clampText(text, maxChars);
  return { text: c.text, truncated: c.truncated, note: null };
}

export interface SheetRows {
  name: string;
  rows: unknown[][];
}

/** Spreadsheet tabs → one text block, with "Sheet: name" headings when there are several. */
export function sheetsToText(sheets: SheetRows[], maxChars: number, totalSheets = sheets.length): ExtractResult {
  const parts: string[] = [];
  let left = maxChars;
  let truncated = totalSheets > sheets.length;
  let read = 0;
  for (const s of sheets) {
    if (left < 40) {
      truncated = true;
      break;
    }
    const heading = totalSheets > 1 ? `Sheet: ${s.name}\n` : "";
    const r = rowsToText(s.rows, { maxChars: Math.max(0, left - heading.length - 2) });
    read++;
    if (r.truncated) truncated = true;
    if (!r.text) continue;
    const block = heading + r.text;
    parts.push(block);
    left -= block.length + 2;
  }
  const text = parts.join("\n\n");
  if (!text) throw new ExtractError("This spreadsheet looks empty.");
  const note =
    totalSheets > 1 ? `${read} of ${totalSheets} sheets${truncated ? " (first rows)" : ""}` : truncated ? "First rows only" : null;
  return { text, truncated, note };
}

// ---- PDF (pdf.js) — structural types so the legacy and modern builds both fit

interface PdfTextItemLike {
  str?: string;
  hasEOL?: boolean;
  type?: string;
}
interface PdfPageLike {
  getTextContent(): Promise<{ items: PdfTextItemLike[] }>;
  cleanup(): unknown;
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
}
export interface PdfJsLike {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDocLike>; destroy(): Promise<void> };
  GlobalWorkerOptions: { workerSrc: string };
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

/** Read a PDF page by page, stopping once maxChars is reached. */
export async function pdfToText(
  pdfjs: PdfJsLike,
  data: Uint8Array,
  opts: {
    maxChars: number;
    onProgress?: (p: ExtractProgress) => void;
    signal?: AbortSignal;
    /** Extra getDocument() params, e.g. { worker } for a dedicated PDFWorker. */
    params?: Record<string, unknown>;
  }
): Promise<ExtractResult> {
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
    ...opts.params,
  });
  let doc: PdfDocLike;
  try {
    doc = await task.promise;
  } catch (e) {
    task.destroy().catch(() => {});
    const name = (e as { name?: string })?.name || "";
    if (name === "PasswordException") throw new ExtractError("This PDF is password-protected. Remove the password and try again.");
    if (name === "InvalidPDFException") throw new ExtractError("This file isn't a valid PDF, or it's damaged.");
    throw new ExtractError("Couldn't open this PDF. It may be damaged — try exporting it again.");
  }
  try {
    const total = doc.numPages;
    const limit = Math.min(total, MAX_PDF_PAGES);
    const parts: string[] = [];
    let len = 0;
    let read = 0;
    let full = false;
    opts.onProgress?.({ label: "Reading", done: 0, total, unit: "pages" });
    for (let n = 1; n <= limit; n++) {
      if (opts.signal?.aborted) throw abortError();
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let t = "";
      for (const it of content.items) {
        if (typeof it.str !== "string") continue;
        t += it.str;
        if (it.hasEOL) t += "\n";
      }
      page.cleanup();
      t = normalizeText(t);
      read = n;
      if (t) {
        const block = total > 1 ? `[Page ${n}]\n${t}` : t;
        parts.push(block);
        len += block.length + 2;
      }
      opts.onProgress?.({ label: "Reading", done: n, total, unit: "pages" });
      if (len >= opts.maxChars) {
        full = n < total;
        break;
      }
    }
    const joined = parts.join("\n\n");
    const textOnly = joined.replace(/\[Page \d+\]/g, "").trim();
    if (textOnly.length < 20)
      throw new ExtractError("This PDF has no selectable text — it's probably a scan. Try a text-based PDF, or paste the key parts into your brief.");
    const c = clampText(joined, opts.maxChars);
    const capped = limit < total && read === limit;
    const truncated = c.truncated || full || capped;
    return {
      text: c.text,
      truncated,
      note: truncated && read < total ? `Read ${read} of ${total} pages` : `${total} ${total === 1 ? "page" : "pages"}`,
    };
  } finally {
    await doc.destroy().catch(() => {});
  }
}

type MammothLike = { extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };

/** Word .docx → plain text. */
export async function docxToText(mammoth: MammothLike, buf: ArrayBuffer, maxChars: number): Promise<ExtractResult> {
  let value: string;
  try {
    value = (await mammoth.extractRawText({ arrayBuffer: buf })).value;
  } catch {
    throw new ExtractError("Couldn't read this Word file. It may be password-protected or damaged — try saving it again as .docx.");
  }
  const text = normalizeText(value || "");
  if (!text) throw new ExtractError("This Word document has no text in it.");
  const c = clampText(text, maxChars);
  return { text: c.text, truncated: c.truncated, note: null };
}

// ---------------------------------------------------------------- browser loaders

/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfModule = PdfJsLike & { PDFWorker: new (p: { port: Worker }) => { destroy(): void } };
let pdfjsPromise: Promise<PdfModule> | null = null;

/**
 * pdf.js, bundled by webpack as a lazy chunk. The legacy build carries
 * polyfills (e.g. Promise.withResolvers) for older Safari/iOS.
 *
 * Note for Next 14: `GlobalWorkerOptions.workerSrc = new URL("…worker.min.mjs",
 * import.meta.url)` emits the worker as a raw .mjs *asset*, which Next 14's SWC
 * minifier parses as a classic script and fails the production build on. A
 * `new Worker(new URL(…))` is bundled as a real worker chunk instead (below).
 */
function loadPdfjs(): Promise<PdfModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const mod: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdfjs: PdfModule = mod?.getDocument ? mod : mod?.default;
      if (!pdfjs?.getDocument) throw new Error("pdf.js failed to load");
      return pdfjs;
    })().catch((e) => {
      pdfjsPromise = null; // allow a retry (e.g. flaky network)
      throw e;
    });
  }
  return pdfjsPromise;
}

/**
 * A dedicated pdf.js worker for one document (terminated afterwards), so
 * parsing never blocks the page and concurrent PDFs can't interfere. Resolves
 * null when workers are unavailable or the worker doesn't say "ready" in time.
 */
function startPdfWorker(timeoutMs = 12000): Promise<Worker | null> {
  if (typeof Worker === "undefined") return Promise.resolve(null);
  let w: Worker;
  try {
    w = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url));
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      if (!ok) w.terminate();
      resolve(ok ? w : null);
    };
    const onMessage = () => finish(true); // pdf.js workers post "ready" as soon as they load
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
  });
}

/** Fallback: run pdf.js's worker code on the main thread (slower, but always works). */
async function useMainThreadPdfWorker(): Promise<void> {
  // @ts-ignore — the worker bundle ships without type declarations
  await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs"); // sets globalThis.pdfjsWorker
}

async function readPdf(file: File, opts: { maxChars: number; onProgress?: (p: ExtractProgress) => void; signal?: AbortSignal }) {
  const [pdfjs, buf] = await Promise.all([loadPdfjs(), file.arrayBuffer()]);
  const port = await startPdfWorker();
  let worker: { destroy(): void } | null = null;
  try {
    if (port) worker = new pdfjs.PDFWorker({ port });
    else await useMainThreadPdfWorker();
    return await pdfToText(pdfjs, new Uint8Array(buf), { ...opts, params: worker ? { worker } : undefined });
  } finally {
    try {
      worker?.destroy();
    } catch {
      /* already gone */
    }
    port?.terminate();
  }
}

async function loadMammoth(): Promise<MammothLike> {
  const m: any = await import("mammoth");
  return (m?.extractRawText ? m : m?.default) as MammothLike;
}

async function loadPapa(): Promise<PapaLike> {
  const m: any = await import("papaparse");
  return (m?.parse ? m : m?.default) as PapaLike;
}

async function loadExcel(): Promise<{ read: (f: Blob, o: { sheet: number }) => Promise<unknown[][]>; names: (f: Blob) => Promise<string[]> }> {
  const m: any = await import("read-excel-file");
  return { read: m.default, names: m.readSheetNames };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Is this a load failure of our own code chunk / asset (offline, deploy in progress)? */
function isChunkError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message || e || "");
  return /chunk|dynamically imported module|import|fetch|pdf\.js failed/i.test(msg) && !(e instanceof ExtractError);
}

/**
 * Extract text from a File in the browser. Throws ExtractError with a
 * friendly message, or an AbortError when `signal` aborts.
 */
export async function extractFile(
  file: File,
  kind: FileKind,
  opts: { maxChars: number; onProgress?: (p: ExtractProgress) => void; signal?: AbortSignal }
): Promise<ExtractResult> {
  if (file.size > MAX_FILE_BYTES) throw new ExtractError("This file is over the 15 MB limit.");
  if (file.size === 0) throw new ExtractError("This file is empty.");
  const { maxChars, onProgress, signal } = opts;
  try {
    switch (kind) {
      case "pdf": {
        onProgress?.({ label: "Opening PDF…" });
        return await readPdf(file, { maxChars, onProgress, signal });
      }
      case "docx": {
        onProgress?.({ label: "Reading document…" });
        const [mammoth, buf] = await Promise.all([loadMammoth(), file.arrayBuffer()]);
        return await docxToText(mammoth, buf, maxChars);
      }
      case "xlsx": {
        onProgress?.({ label: "Opening spreadsheet…" });
        const xl = await loadExcel();
        let names: string[];
        try {
          names = await xl.names(file);
        } catch {
          throw new ExtractError("Couldn't read this spreadsheet. It may be password-protected or damaged — try saving it again as .xlsx.");
        }
        if (!names.length) throw new ExtractError("This spreadsheet has no sheets.");
        const take = Math.min(names.length, MAX_SHEETS);
        const sheets: SheetRows[] = [];
        let chars = 0;
        for (let i = 0; i < take; i++) {
          if (signal?.aborted) throw abortError();
          onProgress?.({ label: "Reading", done: i, total: take, unit: "sheets" });
          let rows: unknown[][] = [];
          try {
            rows = await xl.read(file, { sheet: i + 1 });
          } catch {
            if (i === 0) throw new ExtractError("Couldn't read this spreadsheet. Try saving it again as .xlsx or CSV.");
          }
          sheets.push({ name: names[i], rows });
          chars += rows.length * 12; // rough: stop opening more sheets once the budget is clearly spent
          if (chars > maxChars * 4) break;
        }
        onProgress?.({ label: "Reading", done: take, total: take, unit: "sheets" });
        return sheetsToText(sheets, maxChars, names.length);
      }
      case "csv": {
        onProgress?.({ label: "Reading rows…" });
        const [Papa, buf] = await Promise.all([loadPapa(), file.arrayBuffer()]);
        const raw = decodeText(buf);
        if (looksBinary(raw)) throw new ExtractError("This doesn't look like a CSV text file.");
        return csvToText(Papa, raw, maxChars);
      }
      case "txt":
      case "md": {
        onProgress?.({ label: "Reading…" });
        return plainToText(decodeText(await file.arrayBuffer()), maxChars);
      }
    }
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    if ((e as { name?: string })?.name === "AbortError") throw e;
    if (isChunkError(e)) throw new ExtractError("Couldn't load the file reader. Check your connection and try again.");
    const noun: Record<FileKind, string> = { pdf: "PDF", docx: "Word document", xlsx: "spreadsheet", csv: "CSV file", txt: "text file", md: "Markdown file" };
    throw new ExtractError(`Couldn't read this ${noun[kind]}. It may be damaged or in an unusual format.`);
  }
  throw new ExtractError("This file type isn't supported.");
}
