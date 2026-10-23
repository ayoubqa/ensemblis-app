// Markdown → simple document blocks, shared by the PDF and Word exporters.
//
// Parsing uses the same engine react-markdown uses on screen (unified +
// remark-parse + remark-gfm, already installed as react-markdown's
// dependencies), so tables, nested lists and inline marks come out exactly
// as they render. Inline citations like "[3]" or "[1, 4]" become `cite`
// inlines so exporters can style/link them while keeping the "[n]" text.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import type { Link, Nodes, Parents, PhrasingContent, Root, RootContent, Table, Text } from "mdast";
import type { TaskSource } from "@/lib/api";
import { splitCitations, type Inline } from "./cites";

export type { Inline } from "./cites";
export { CITE_RE, citeNumbers, splitCitations } from "./cites";

export type Align = "left" | "right" | "center" | null;

export interface ListItemBlock {
  checked: boolean | null;
  blocks: Block[];
}

export type Block =
  | { type: "heading"; depth: number; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItemBlock[] }
  | { type: "table"; align: Align[]; header: Inline[][]; rows: Inline[][][] }
  | { type: "code"; text: string; lang: string | null }
  | { type: "quote"; blocks: Block[] }
  | { type: "hr" };

export interface ParseOptions {
  /** Which citation numbers are real sources. Default: any number 1–999. */
  isCite?: (n: number) => boolean;
  /**
   * Which link destinations stay links (see linkAllowed); the others become plain text, and text a
   * viewer could link again (a URL or e-mail address on a host it refuses) is reduced (see unlinkRuns).
   * Default: http(s) and mailto links, text as written.
   */
  isLinkAllowed?: (url: string) => boolean;
}

// ---------- Link allowlist (on screen and in exports) ----------

/** Where a report may link: the API's linkDomains for it (absent from older APIs and legacy reports). */
export interface LinkScope {
  linkDomains?: readonly string[] | null;
}

// These rules live here only: the stored-text cleaner (backend/src/research/citations.ts) does not
// carry them, and every output (screen, PDF, Word, the .md file and Copy) is checked with linkAllowed.
/** Second-level labels that make a public suffix under a two-letter country TLD (co.uk, com.au…): an allowed one allows its exact host only. */
const PUBLIC_SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac", "edu", "ltd", "plc", "me", "or", "ne", "go", "gob", "gouv", "nic", "mil"]);
/** Shared-hosting suffixes, where anyone can create a subdomain: an allowed domain that is or ends with one allows its exact host only. */
const SHARED_HOSTING = [
  "s3.amazonaws.com", "amazonaws.com", "cloudfront.net", "storage.googleapis.com", "googleusercontent.com", "appspot.com", "web.app", "firebaseapp.com",
  "blob.core.windows.net", "azurewebsites.net", "github.io", "githubusercontent.com", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev",
  "workers.dev", "onrender.com", "fly.dev", "glitch.me", "ngrok.io", "ngrok-free.app", "trycloudflare.com", "blogspot.com", "wordpress.com", "substack.com", "medium.com",
];

/** A public suffix such as co.uk: a generic second-level label under a two-letter country TLD. */
const isPublicSuffix = (d: string) => PUBLIC_SECOND_LEVEL.has(/^([a-z0-9-]+)\.[a-z]{2}$/.exec(d)?.[1] ?? "");
const isSharedHost = (d: string) => SHARED_HOSTING.some((s) => d === s || d.endsWith(`.${s}`));

/** Lower-case, without trailing dots or a leading "www." (kept on a shared-hosting host, where it names another tenant). */
const normDomain = (d: string) => {
  const h = d.trim().toLowerCase().replace(/\.+$/, "");
  return isSharedHost(h) ? h : h.replace(/^www\./, "");
};

/** A host's registrable domain: its last two labels, or three when those two are a public suffix (attacker.co.uk). */
function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.+$/, "").split(".");
  return labels.slice(labels.length > 2 && isPublicSuffix(labels.slice(-2).join(".")) ? -3 : -2).join(".");
}

/** The host a browser goes to for a URL (WHATWG parsing), or "" when it cannot parse it. */
function urlHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * The domains a report may link to: linkDomains when the API sent them, else its sources'
 * domains (and their URLs' hosts), else none.
 */
export function linkAllowlist(linkDomains: readonly string[] | null | undefined, sources?: readonly TaskSource[] | null): string[] {
  const raw = linkDomains ?? (sources ?? []).flatMap((s) => [s.domain, urlHost(s.url ?? "")]);
  return [...new Set(raw.filter((d): d is string => typeof d === "string").map(normDomain).filter(Boolean))];
}

/**
 * Whether a link in report markdown (model output, which may carry a prompt-injected link) stays a
 * link: an in-page #anchor, or an absolute http(s) URL whose host — lower-cased, trailing dots and a
 * leading "www." ignored — is an allowed domain or a subdomain of one. A public suffix (gov.uk, co.uk)
 * and a shared-hosting domain (s3.amazonaws.com, vendor.github.io…) allow their exact host only
 * ("www." included on shared hosting, where it is another tenant). The host is the one a browser goes
 * to (WHATWG parsing), and it must also be the URL's plain authority, so no reader can resolve it
 * elsewhere: no userinfo, backslash, percent or other escape, IP-literal brackets or whitespace.
 */
export function linkAllowed(href: string | null | undefined, allowed: readonly string[]): boolean {
  if (!href) return false;
  if (href.startsWith("#")) return true;
  const authority = /^https?:\/\/([^/?#]*)/i.exec(href)?.[1];
  const plain = authority ? /^([a-z0-9.-]+)(?::\d{1,5})?$/i.exec(authority)?.[1] : undefined;
  if (!plain || /[\x00-\x20\x7f]/.test(href)) return false;
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return false;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || u.hostname !== plain.toLowerCase()) return false;
  const host = normDomain(u.hostname);
  return (
    !!host &&
    allowed.some((d) => {
      const a = normDomain(d);
      return !!a && (host === a || (!isPublicSuffix(a) && !isSharedHost(a) && host.endsWith(`.${a}`)));
    })
  );
}

// Writes "-" bullets and "---" rules, as reports usually do (the tree does not keep which ones the markdown used).
// Two escapes GFM's own writer lacks: the ":" of an upper-case "HTTP://" (viewers autolink it), and a ":"
// right after a reference or footnote call (at a line start, "[k]:" would make a definition).
const PHRASING_ONLY = ["autolink", "link", "image", "label"] as const;
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: "-",
    rule: "-",
    unsafe: [
      { character: ":", before: "[PS]", after: "\\/", inConstruct: "phrasing", notInConstruct: [...PHRASING_ONLY] },
      { character: ":", before: "\\]", inConstruct: "phrasing", notInConstruct: [...PHRASING_ONLY] },
    ],
  });

export function parseMarkdownTree(md: string): Root {
  return processor.parse(md.replace(/\r\n?/g, "\n")) as Root;
}

type Marks = Omit<Inline, "text" | "cite">;

/** Markdown → blocks. Never throws: falls back to one paragraph per line. */
export function markdownToBlocks(md: string, opts: ParseOptions = {}): Block[] {
  const isCite = opts.isCite ?? ((n: number) => n >= 1 && n <= 999);
  const isLinkAllowed = opts.isLinkAllowed ?? (() => true);
  const unlink = opts.isLinkAllowed ?? null;
  try {
    const tree = parseMarkdownTree(md);
    const defs = new Map<string, string>();
    collectDefinitions(tree, defs);
    return convertBlocks(tree.children, { isCite, isLinkAllowed, unlink, defs });
  } catch {
    return md
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => ({ type: "paragraph" as const, inlines: unlink ? unlinkRuns([{ text: p }], unlink) : [{ text: p }] }));
  }
}

interface Ctx {
  isCite: (n: number) => boolean;
  isLinkAllowed: (url: string) => boolean;
  /** The given isLinkAllowed: link-shaped text on a host it refuses is reduced. Null: text as written. */
  unlink: ((url: string) => boolean) | null;
  defs: Map<string, string>;
}

/** A block's runs: link-shaped text reduced (with ctx.unlink), neighbours with identical marks merged. */
function runsOf(list: Inline[], ctx: Ctx): Inline[] {
  return tidy(ctx.unlink ? unlinkRuns(list, ctx.unlink) : list);
}

function collectDefinitions(node: Nodes, defs: Map<string, string>) {
  if (node.type === "definition") defs.set(node.identifier.toLowerCase(), node.url);
  if ("children" in node) for (const c of (node as Parents).children) collectDefinitions(c as Nodes, defs);
}

function convertBlocks(nodes: RootContent[], ctx: Ctx): Block[] {
  const out: Block[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        out.push({ type: "heading", depth: node.depth, inlines: runsOf(inlines(node.children, {}, ctx), ctx) });
        break;
      case "paragraph": {
        const ins = runsOf(inlines(node.children, {}, ctx), ctx);
        if (ins.length) out.push({ type: "paragraph", inlines: ins });
        break;
      }
      case "list":
        out.push({
          type: "list",
          ordered: !!node.ordered,
          start: typeof node.start === "number" ? node.start : 1,
          items: node.children.map((li) => ({
            checked: typeof li.checked === "boolean" ? li.checked : null,
            blocks: convertBlocks(li.children, ctx),
          })),
        });
        break;
      case "table":
        out.push(convertTable(node, ctx));
        break;
      case "code":
        out.push({ type: "code", text: ctx.unlink ? unlinkText(node.value, ctx.unlink) : node.value, lang: node.lang ?? null });
        break;
      case "blockquote":
        out.push({ type: "quote", blocks: convertBlocks(node.children, ctx) });
        break;
      case "thematicBreak":
        out.push({ type: "hr" });
        break;
      case "html": {
        const text = stripHtml(node.value);
        if (text) out.push({ type: "paragraph", inlines: runsOf([{ text }], ctx) });
        break;
      }
      case "definition":
      case "footnoteDefinition":
      case "yaml" as string:
        break;
      default:
        // Unknown block (e.g. math): keep its text so nothing silently disappears.
        if ("children" in node) {
          const ins = runsOf(inlines((node as Parents).children as PhrasingContent[], {}, ctx), ctx);
          if (ins.length) out.push({ type: "paragraph", inlines: ins });
        } else if ("value" in node && typeof (node as { value?: unknown }).value === "string") {
          out.push({ type: "paragraph", inlines: runsOf([{ text: (node as { value: string }).value }], ctx) });
        }
    }
  }
  return out;
}

function convertTable(node: Table, ctx: Ctx): Block {
  const rows = node.children.map((row) => row.children.map((cell) => runsOf(inlines(cell.children, {}, ctx), ctx)));
  const width = Math.max(1, ...rows.map((r) => r.length));
  const pad = (r: Inline[][]) => (r.length < width ? [...r, ...Array.from({ length: width - r.length }, () => [] as Inline[])] : r.slice(0, width));
  const align: Align[] = Array.from({ length: width }, (_, i) => (node.align?.[i] as Align) ?? null);
  return { type: "table", align, header: pad(rows[0] ?? []), rows: rows.slice(1).map(pad) };
}

function inlines(nodes: PhrasingContent[], marks: Marks, ctx: Ctx): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        if (marks.href) out.push({ ...marks, text: node.value });
        else out.push(...splitCitations(node.value, marks, ctx.isCite));
        break;
      case "strong":
        out.push(...inlines(node.children, { ...marks, bold: true }, ctx));
        break;
      case "emphasis":
        out.push(...inlines(node.children, { ...marks, italic: true }, ctx));
        break;
      case "delete":
        out.push(...inlines(node.children, { ...marks, strike: true }, ctx));
        break;
      case "inlineCode":
        out.push({ ...marks, code: true, text: node.value });
        break;
      case "break":
        out.push({ ...marks, text: "\n" });
        break;
      case "link": {
        const safe = linkUrl(node.url, ctx);
        out.push(...inlines(node.children, safe ? { ...marks, href: safe } : marks, ctx));
        break;
      }
      case "linkReference": {
        const label = toText(node.children);
        const n = /^\d{1,3}$/.test(label) ? Number(label) : NaN;
        if (!marks.href && Number.isFinite(n) && ctx.isCite(n)) {
          out.push({ ...marks, text: `[${n}]`, cite: n });
          break;
        }
        const url = linkUrl(ctx.defs.get(node.identifier.toLowerCase()) ?? "", ctx);
        out.push(...inlines(node.children, url ? { ...marks, href: url } : marks, ctx));
        break;
      }
      case "footnoteReference": {
        const n = /^\d{1,3}$/.test(node.identifier) ? Number(node.identifier) : NaN;
        if (Number.isFinite(n) && ctx.isCite(n)) out.push({ ...marks, text: `[${n}]`, cite: n });
        else out.push({ ...marks, text: `[${node.label ?? node.identifier}]` });
        break;
      }
      case "image":
      case "imageReference":
        if (node.alt) out.push({ ...marks, text: node.alt });
        break;
      case "html": {
        const t = stripHtml(node.value);
        if (/^<br\s*\/?>$/i.test(node.value.trim())) out.push({ ...marks, text: "\n" });
        else if (t) out.push({ ...marks, text: t });
        break;
      }
      default:
        if ("children" in node) out.push(...inlines((node as Parents).children as PhrasingContent[], marks, ctx));
        else if ("value" in node && typeof (node as { value?: unknown }).value === "string") out.push({ ...marks, text: (node as { value: string }).value });
    }
  }
  return out;
}

/** Merge neighbours with identical marks; drop empty runs. */
function tidy(list: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const it of list) {
    if (!it.text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.cite === undefined && it.cite === undefined && sameMarks(prev, it)) prev.text += it.text;
    else out.push({ ...it });
  }
  return out;
}

function sameMarks(a: Inline, b: Inline) {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.code === !!b.code && !!a.strike === !!b.strike && a.href === b.href;
}

function toText(nodes: PhrasingContent[]): string {
  return nodes.map((n) => ("value" in n ? String(n.value) : "children" in n ? toText(n.children as PhrasingContent[]) : "")).join("");
}

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Only http(s) and mailto links are kept in exported documents. */
export function safeUrl(url: string): string | undefined {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : undefined;
}

/** A link destination an export keeps (safe, and allowed by isLinkAllowed); otherwise its text is plain. */
function linkUrl(url: string, ctx: Ctx): string | undefined {
  const u = safeUrl(url);
  return u && ctx.isLinkAllowed(u) ? u : undefined;
}

// ---------- Link-shaped text (exports) ----------
//
// PDF viewers (Chrome's, Acrobat, pdf.js) turn URL and e-mail text into links of their own, so a
// refused link whose text is its URL, or a URL or address written as plain text, could still be
// clicked in an export. Such text on a host isLinkAllowed refuses is reduced to a domain no viewer links.

/** Where a URL literal starts — "http(s)://" or "www." with its host, or "mailto:" — anywhere in a word, as PDFium finds one. */
const URL_START = /(?:https?:\/\/|www\.)[^\s/?#]*|mailto:/giu;
/**
 * The same, and a protocol-relative "//host" (with a dot) at the start of a word: Markdown text
 * where a viewer may read a link destination (see leadText).
 */
const URL_START_RELATIVE = /(?:https?:\/\/|www\.)[^\s/?#]*|mailto:|(?<![^\s"'(<[{])\/\/[^\s/?#.]+\.[^\s/?#]*/giu;
const WORD_REST = /\S*/uy;
/**
 * A URL literal up to prose glued to it (“ ” — ， CJK…): its host up to the first character outside
 * [A-Za-z0-9.:-], where micromark ends one, then its path (URL_PATH).
 */
const URL_HEAD = /^(?:https?:\/\/|www\.|\/\/)[A-Za-z0-9.:-]*/i;
/** A path: ASCII, and letters, digits and marks of any script but Han and Kana; it ends at whitespace, other punctuation or symbols (“ ” — ， 。) and CJK prose. */
const URL_PATH = /[/?#](?:[\x21-\x7e]|(?![\p{scx=Han}\p{scx=Hira}\p{scx=Kana}])[\p{L}\p{N}\p{M}])*/uy;
/** Trailing punctuation that ends the sentence rather than the URL (kept after the reduced domain). */
const URL_TRAIL = /[.,:;!?'"*_~)\]}>]+$/;
/** The domain after an e-mail address's "@", read as broadly as any viewer reads one (pdf.js takes symbols too). */
const EMAIL_DOMAIN = /(?:[^\s\p{P}<>]|[-_])+(?:\.(?:[^\s\p{P}<>]|[-_])+)+/uy;
/** A top-level domain after a dot of an e-mail domain, wherever a viewer ends it: 2–24 letters or an xn-- label (react@18.3.1 and deploy@10.0.0.5 have none). */
const EMAIL_TLD = /\.(?:xn--|\p{L}{2,24}(?!\p{L}))/u;
/** A character of an e-mail address's local part (reduced with it). */
const EMAIL_LOCAL = /[\p{L}\p{N}._%+-]/u;
/** What an export or a viewer's text extraction may drop: format characters, and the emoji and variation selectors pdfSafe removes (keep in sync with GLYPHS in export-pdf.ts). */
const INVISIBLE = /[\p{Cf}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** The host a viewer's link would go to (WHATWG parsing), else what follows the "//". */
function hostIn(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return /^[a-z]+:\/*(?:[^/?#@\s]*@)?([^/?#:\\\s]*)/i.exec(url)?.[1] ?? "";
  }
}

/** A host as text no viewer links: an IP address as it is, else its registrable domain, without a "www." a viewer would read as a URL. */
function domainText(host: string): string {
  if (/^[\d.]+$|:/.test(host)) return host;
  let d = registrableDomain(host).replace(/^\.+/, "");
  while (/www\./i.test(d)) d = d.slice(d.indexOf(".") + 1);
  return d;
}

const withScheme = (literal: string) => (/^www\./i.test(literal) ? `http://${literal}` : literal.startsWith("//") ? `https:${literal}` : literal);

/** A word's URL literal (see URL_HEAD and URL_PATH). */
function urlHead(word: string): string {
  const head = URL_HEAD.exec(word)?.[0];
  if (head === undefined) return word;
  URL_PATH.lastIndex = head.length;
  return head + (URL_PATH.exec(word)?.[0] ?? "");
}
/** Percent escapes decoded byte by byte (never throws), as a mail client reads a mailto: link. */
const unescapePercent = (s: string) => s.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/**
 * Whether a viewer that reads a URL literal on into the prose glued to it (pdf.js reads up to
 * whitespace) goes to another host that could exist: not when it cannot parse the word, or gets the
 * same host, or one whose last label alone ran on into the prose (acme.xn--com-…, a top-level
 * domain no registry offers).
 */
function readsOn(url: string, word: string): boolean {
  const near = urlHost(withScheme(url)).replace(/\.$/, "");
  const far = urlHost(withScheme(word)).replace(/\.$/, "");
  if (!far || far === near) return false;
  const a = near.split(".");
  const b = far.split(".");
  return a.length !== b.length || a.slice(0, -1).join(".") !== b.slice(0, -1).join(".") || !b[b.length - 1].startsWith("xn--");
}

/**
 * URL literals on a host `ok` refuses, each reduced (up to whitespace) to its registrable domain.
 * The host decides; an allowed URL's path is read on, as a viewer may end that URL early (pdf.js
 * stops at a bracket) and link what follows. Prose glued to a URL stays as written (see URL_HEAD);
 * an allowed URL is reduced too when a viewer reading on into that prose goes elsewhere. A "mailto:"
 * literal (pdf.js links whatever follows it) goes when an address in it, escapes decoded, is on a
 * domain `ok` refuses. With `relative`, a "//host" literal is judged too (as https:).
 */
function urlEdits(seen: string, ok: (url: string) => boolean, relative = false): Edit[] {
  const edits: Edit[] = [];
  const start = relative ? URL_START_RELATIVE : URL_START;
  const re = new RegExp(start.source, start.flags);
  let checked = 0; // a mailto: literal read whole ends here (one inside it holds no other address)
  for (let m = re.exec(seen); m; m = re.exec(seen)) {
    const end = m.index + m[0].length;
    const mailto = /^m/i.test(m[0]);
    if (mailto && m.index < checked) continue;
    WORD_REST.lastIndex = end;
    const wordEnd = end + (WORD_REST.exec(seen)?.[0].length ?? 0);
    const word = seen.slice(m.index, wordEnd).replace(URL_TRAIL, "");
    const literal = mailto ? word : urlHead(word).replace(URL_TRAIL, "");
    if (!mailto && ok(withScheme(literal)) && (literal === word || !readsOn(literal, word))) {
      re.lastIndex = Math.min(end, m.index + literal.length);
      continue;
    }
    const text = mailto ? emailEdits(unescapePercent(literal), ok)[0]?.text : domainText(hostIn(withScheme(literal)));
    if (text === undefined) {
      checked = wordEnd;
      continue;
    }
    edits.push({ start: m.index, end: m.index + literal.length, text });
    re.lastIndex = m.index + literal.length;
  }
  return edits;
}

/**
 * E-mail addresses on a domain `ok` refuses, each reduced to "an address at <registrable domain>":
 * every "@" after a non-space and before a dotted domain with a top-level domain, wherever its local
 * part starts.
 */
function emailEdits(seen: string, ok: (url: string) => boolean): Edit[] {
  const edits: Edit[] = [];
  let floor = 0;
  for (let i = seen.indexOf("@"); i >= 0; i = seen.indexOf("@", i + 1)) {
    if (i === 0 || /\s/.test(seen[i - 1])) continue;
    EMAIL_DOMAIN.lastIndex = i + 1;
    const domain = EMAIL_DOMAIN.exec(seen)?.[0];
    if (!domain || !EMAIL_TLD.test(domain) || ok(`https://${domain}/`)) continue;
    let start = i;
    while (start > floor && EMAIL_LOCAL.test(seen[start - 1])) start--;
    if (start - 7 >= floor && seen.slice(start - 7, start).toLowerCase() === "mailto:") start -= 7;
    floor = i + 1 + domain.length;
    edits.push({ start, end: floor, text: `an address at ${domainText(domain)}` });
    i = floor - 1;
  }
  return edits;
}

/**
 * The runs with the edits `find` gives for their text, read together as a viewer reads it (marks
 * may split a URL), with the characters a viewer may drop left out when `drop` is set. An edit's
 * text takes the marks of the run it starts in.
 */
function rewrite(seg: Inline[], find: (seen: string) => Edit[], drop: boolean): Inline[] {
  const joined = seg.map((r) => r.text).join("");
  let seen = "";
  const at: number[] = []; // where each code unit of `seen` is in `joined`
  let i = 0;
  for (const ch of joined) {
    if (!drop || !INVISIBLE.test(ch)) {
      seen += ch;
      for (let k = 0; k < ch.length; k++) at.push(i + k);
    }
    i += ch.length;
  }
  at.push(joined.length);
  const edits = find(seen).map((e) => ({ ...e, start: at[e.start], end: at[e.end] }));
  if (!edits.length) return seg;
  const out: Inline[] = [];
  let pos = 0;
  let e = 0;
  for (const r of seg) {
    const end = pos + r.text.length;
    let text = "";
    for (let k = pos; k < end; ) {
      const ed = edits[e];
      if (!ed || ed.start >= end) {
        text += joined.slice(k, end);
        break;
      }
      if (ed.start > k) text += joined.slice(k, ed.start);
      if (ed.start >= k) text += ed.text;
      k = Math.min(ed.end, end);
      if (ed.end <= end) e++;
    }
    out.push({ ...r, text });
    pos = end;
  }
  return out;
}

/**
 * The runs with link-shaped text on a host `allowed` refuses reduced: URL literals first, then the
 * e-mail addresses left in that text (so neither can join with the other's reduction into a new
 * one), in the text as written (the Word file keeps every character) and as a PDF prints it or a
 * viewer reads it (see INVISIBLE). Each run of text between two citations is read as one. With
 * `relative`, "//host" literals are judged too (Markdown text, see urlEdits).
 */
function unlinkRuns(list: Inline[], allowed: (url: string) => boolean, relative = false): Inline[] {
  const ok = (url: string) => {
    try {
      return allowed(url);
    } catch {
      return false;
    }
  };
  const out: Inline[] = [];
  for (let i = 0; i < list.length; ) {
    if (list[i].cite !== undefined) {
      out.push(list[i++]);
      continue;
    }
    const seg: Inline[] = [];
    while (i < list.length && list[i].cite === undefined) seg.push(list[i++]);
    let runs = seg;
    for (const drop of [false, true]) runs = rewrite(rewrite(runs, (t) => urlEdits(t, ok, relative), drop), (t) => emailEdits(t, ok), drop);
    out.push(...runs);
  }
  return out;
}

/** Plain text (a code block) with link-shaped text reduced, as unlinkRuns does. */
function unlinkText(text: string, allowed: (url: string) => boolean, relative = false): string {
  return unlinkRuns([{ text }], allowed, relative)[0].text;
}

/** Text an export prints outside the report's markdown (its title, its footer), link-shaped text reduced as in the body. */
export function reduceLinkText(text: string, isLinkAllowed: (url: string) => boolean): string {
  return unlinkText(text, isLinkAllowed);
}

// ---------- Markdown out (the .md file and Copy) ----------
//
// A Markdown viewer that renders HTML (GitHub, GitLab, mail previews) would load an image or raw
// HTML in the file with no click, and link whatever the markdown links. So the file is the report
// with only what the screen keeps, and otherwise as written: the parser the screen uses reads it,
// and only the spans of what the file does not keep as it is (see keepAllowed) are written anew,
// by that parser's writer (which escapes text that could make markup again). The file is then read
// back, by that parser and as plain CommonMark (a viewer without GFM's tables and footnotes): if
// either reads something left to change, or the edits read differently from what they meant, the
// whole report is written by the writer instead, and failing that it is a code block.

const FLOW_PARENTS = new Set(["root", "blockquote", "listItem", "footnoteDefinition"]);
/** Plain CommonMark, as a viewer without GFM reads the file. */
const commonmark = unified().use(remarkParse);

/** The labels of the definitions `ok` allows (the ones the file keeps). */
function allowedLabels(node: Nodes, ok: (url: string) => boolean, out = new Set<string>()): Set<string> {
  if (node.type === "definition" && ok(node.url)) out.add(node.identifier.toLowerCase());
  if ("children" in node) for (const c of (node as Parents).children) allowedLabels(c as Nodes, ok, out);
  return out;
}

/**
 * An e-mail address written as one ("sales@acme.com", "<sales@acme.com>") on a domain `ok` allows:
 * it stays as written, as an address on such a domain does in the PDF (see emailEdits), which a viewer links.
 */
function keptAddress(link: Link, ok: (url: string) => boolean): boolean {
  const text = toText(link.children);
  const domain = /^[^\s@<>]+@([^\s@<>]+)$/.exec(text)?.[1];
  return !!domain && link.url.toLowerCase() === `mailto:${text.toLowerCase()}` && ok(`https://${domain}/`);
}

/** A span [start, end) of the source, written as `text`. */
interface SrcEdit {
  start: number;
  end: number;
  text: string;
}

/** Where keepAllowed is in the source. */
interface Scope {
  ok: (url: string) => boolean;
  labels: Set<string>;
  src: string;
  /** Where each line of `src` starts (see lineStarts). */
  lines: number[];
  /** What a line inside the current containers starts with ("> ", a list item's indent…). */
  prefix: string;
  /** The current leaf block's phrasing, [start, end) in the source. */
  leaf: [number, number];
  /** In a table cell ("|" is escaped there) or a link's text ("]" is). */
  cell: boolean;
  label: boolean;
  /** In a footnote definition's first paragraph (see leadText). */
  lead: boolean;
  /** Whether the edits are written (not inside a refused link, whose text is written with it). */
  write: boolean;
  /** Text reduced and phrasing written so far for this source (see reduceText and phrasingMarkdown). */
  memo: Map<string, string | null>;
  /** Set when an edit could not be written (the report is then written whole). */
  failed: { value: boolean };
}

/** A child of the node keepAllowed is at, and what the file keeps of it. */
interface Item {
  node: RootContent;
  out: RootContent[];
  /** Written anew; otherwise kept as written, with `edits` inside it. */
  changed: boolean;
  edits: SrcEdit[];
}

function spanOf(node: Nodes, s: Scope): [number, number] {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    s.failed.value = true;
    return [0, 0];
  }
  return [start, end];
}

/**
 * The node's children with only what the file keeps: a refused link, or a reference without an
 * allowed definition, is its text ("[n]" for a citation number); a refused definition goes; an image
 * is its alt text; raw HTML is text (a <br> stays); link-shaped text on a refused host is reduced.
 * Returns the edits that write the source so: each changed child's span (a run of them in a line of
 * text) written anew, nested and overlapping changes in the outermost one, the rest as written.
 */
function keepAllowed(node: Parents, s: Scope): SrcEdit[] {
  const flow = FLOW_PARENTS.has(node.type);
  const items = (node.children as RootContent[]).map((child, i): Item => {
    const it: Item = { node: child, out: [child], changed: false, edits: [] };
    const change = (out: RootContent[]) => Object.assign(it, { out, changed: true });
    switch (child.type) {
      case "link":
      case "linkReference": {
        // A refused link is written anew with its text, so that text's own edits are written only when it
        // may stay a link: an allowed one, or an e-mail link, which its text may keep (see keptAddress).
        // Its text is not a footnote's first word as written (that is "[" or "<"; see leadText).
        const allowed = child.type === "link" ? s.ok(child.url) : s.labels.has(child.identifier.toLowerCase());
        const write = s.write && (allowed || (child.type === "link" && /^mailto:/i.test(child.url)));
        const inner = keepAllowed(child, { ...s, label: true, lead: false, write });
        const label = toText(child.children);
        if (allowed || (child.type === "link" && keptAddress(child, s.ok))) it.edits = inner;
        else if (child.type === "linkReference" && /^\d{1,3}$/.test(label)) {
          // A shortcut written just "[n]" already reads as that text once its definition goes: it stays as written.
          const text: Text = { type: "text", value: `[${label}]` };
          const [start, end] = spanOf(child, s);
          if (child.referenceType === "shortcut" && s.src.slice(start, end) === text.value) it.out = [text];
          else change([text]);
        } else change(child.children);
        break;
      }
      case "definition":
        if (!s.ok(child.url)) change([]);
        break;
      case "image":
      case "imageReference":
        change(child.alt ? [{ type: "text", value: child.alt }] : []);
        break;
      case "html":
        if (!/^<br\s*\/?>$/i.test(child.value.trim()))
          change(flow ? [{ type: "paragraph", children: [{ type: "text", value: unlinkText(child.value, s.ok, true) }] }] : [{ type: "text", value: child.value }]);
        break;
      case "inlineCode":
      case "code": {
        const value = unlinkText(child.value, s.ok);
        if (value !== child.value) change([{ ...child, value }]);
        break;
      }
      default:
        if ("children" in child) it.edits = keepAllowed(child, within(s, node, child, i));
    }
    return it;
  });
  if (!flow) reduceText(items, s);
  const merged: RootContent[] = [];
  for (const c of items.flatMap((it) => it.out)) {
    const prev = merged[merged.length - 1];
    if (c.type === "text" && prev?.type === "text") merged[merged.length - 1] = { type: "text", value: prev.value + c.value };
    else merged.push(c);
  }
  (node as { children: RootContent[] }).children = merged.filter((c) => c.type !== "text" || c.value);
  if (!s.write) return [];
  return flow ? flowEdits(items, s) : phrasingEdits(items, s);
}

/** The scope inside a container: the prefix of its lines, its leaf block, a table cell, a footnote's first paragraph. */
function within(s: Scope, parent: Parents, child: Parents, index: number): Scope {
  const t: Scope = { ...s, lead: false };
  if (child.type === "blockquote") t.prefix += "> ";
  else if (child.type === "footnoteDefinition") t.prefix += "    ";
  else if (child.type === "listItem") {
    // Its content column: the marker and the spaces after it (one when the content is indented code).
    const m = /^(?:[-*+]|\d{1,9}[.)])( *)/.exec(s.src.slice(spanOf(child, s)[0]));
    const spaces = m?.[1].length ?? 0;
    t.prefix += " ".repeat((m?.[0].length ?? 0) - spaces + (spaces >= 1 && spaces <= 4 ? spaces : 1));
  } else if (child.type === "paragraph" || child.type === "heading" || child.type === "tableCell") {
    const kids = child.children;
    if (kids.length) t.leaf = [spanOf(kids[0], s)[0], spanOf(kids[kids.length - 1], s)[1]];
    t.cell = child.type === "tableCell";
    t.lead = parent.type === "footnoteDefinition" && index === 0 && child.type === "paragraph";
  }
  return t;
}

/**
 * Link-shaped text reduced as a viewer reads it, neighbours (e.g. a refused link's text and what
 * follows it) as one. Where that changes the text, the text nodes the change covers are written
 * anew: their items change, and the first of those nodes takes the changed text.
 */
function reduceText(items: Item[], s: Scope): void {
  const groups: { item: number; node: Text }[][] = [];
  let open = false;
  items.forEach((it, i) => {
    for (const c of it.out) {
      if (c.type === "text") {
        if (!open) groups.push([]);
        groups[groups.length - 1].push({ item: i, node: c });
      }
      open = c.type === "text";
    }
  });
  const leads = s.lead && items[0]?.out[0]?.type === "text";
  groups.forEach((g, gi) => {
    const before = g.map((p) => p.node.value).join("");
    let after = s.memo.get(`text ${before}`) ?? unlinkText(before, s.ok, true);
    s.memo.set(`text ${before}`, after);
    let code = 0; // how much of the footnote's first text becomes inline code (see leadText)
    if (leads && gi === 0) {
      // Whether such a viewer reads a definition depends on the whole line as written ("Source: [Eurostat](…)"
      // is none: a link follows the word), not on the first text node alone.
      const from = spanOf(items[0].node, s)[0];
      const eol = s.src.indexOf("\n", from);
      ({ text: after, code } = leadText(after, s.ok, s.src.slice(from, eol === -1 ? s.src.length : eol)));
    }
    if (after === before && !code) return;
    let p = 0;
    while (!code && p < before.length && p < after.length && before[p] === after[p]) p++;
    let q = 0;
    while (q < before.length - p && q < after.length - Math.max(p, code) && before[before.length - 1 - q] === after[after.length - 1 - q]) q++;
    const ends: number[] = [];
    let at = 0;
    for (const piece of g) ends.push((at += piece.node.value.length));
    // The nodes the change [p, before.length - q) covers (an insertion: the one it is at).
    const to = Math.max(p + 1, before.length - q);
    let first = ends.findIndex((e) => e > p);
    if (first < 0) first = g.length - 1;
    let last = first;
    while (last + 1 < g.length && ends[last] < to) last++;
    const a = first ? ends[first - 1] : 0;
    const text = after.slice(a, after.length - (before.length - ends[last]));
    for (let j = first; j <= last; j++) {
      g[j].node.value = j === first ? text : "";
      items[g[j].item].changed = true;
    }
    if (code) {
      const it = items[g[0].item];
      const head = it.out[0] as Text; // g[0].node (see leads)
      it.out = [{ type: "inlineCode", value: head.value.slice(0, code) }, { ...head, value: head.value.slice(code) }, ...it.out.slice(1)];
    }
  });
}

/**
 * A footnote's first word, as written, that a viewer without footnotes reads as a link destination:
 * there "[^1]: //host" is a link definition, as CommonMark reads one (the word alone on its line, or
 * followed by a complete title and nothing else on the line).
 */
const LEAD_DEST = /^(?:<([^<>\n]*)>|(?!<)(\S+))(?=(?:[ \t]+(?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\((?:[^()\\]|\\[\s\S])*\)))?[ \t]*(?:\n|$))/;

/**
 * A footnote's first text with its destination-shaped first word (see LEAD_DEST: protocol-relative,
 * read as https:, or with a scheme) that `ok` refuses reduced as a URL literal is; one with no host
 * to show ("doi:…", "urn:…") stays, as inline code (its first `code` characters), which such a viewer
 * reads as a destination on its own site.
 */
function leadText(text: string, ok: (url: string) => boolean, line?: string): { text: string; code: number } {
  if (line !== undefined) {
    const m = LEAD_DEST.exec(line);
    const dest = m?.[1] ?? m?.[2];
    if (!m || dest === undefined || !/^[\\/]{2}|^[a-z][a-z0-9+.-]*:/i.test(dest)) return { text, code: 0 };
  }
  for (let n = 0; n < 8; n++) {
    const m = LEAD_DEST.exec(text);
    const dest = m?.[1] ?? m?.[2];
    if (!m || dest === undefined || !/^[\\/]{2}|^[a-z][a-z0-9+.-]*:/i.test(dest)) break;
    const url = /^[\\/]{2}/.test(dest) ? `https:${dest}` : dest;
    if (ok(url)) break;
    const shown = domainText(hostIn(url));
    if (!shown) return { text, code: Math.min(m[0].length, text.length) };
    text = `${shown}${text.slice(m[0].length)}`;
  }
  return { text, code: 0 };
}

/** Each run of changed items written anew in its place; the rest as written. */
function phrasingEdits(items: Item[], s: Scope): SrcEdit[] {
  const edits: SrcEdit[] = [];
  for (let i = 0; i < items.length; i++) {
    if (!items[i].changed) {
      edits.push(...items[i].edits);
      continue;
    }
    let j = i;
    while (j + 1 < items.length && items[j + 1].changed) j++;
    const [start] = spanOf(items[i].node, s);
    const [, end] = spanOf(items[j].node, s);
    edits.push({ start, end, text: phrasingMarkdown(items.slice(i, j + 1).flatMap((it) => it.out) as PhrasingContent[], s, start, end) });
    i = j;
  }
  return edits;
}

/** A letter written next to a fragment that does not start or end its line, so the writer escapes it as it stands there. */
const BESIDE = "x";

/**
 * Phrasing as Markdown that reads as exactly that in its place [start, end) of the source: escaped
 * as at a line start only where a line starts, with "|" escaped in a table cell and "]" in a link's text.
 */
function phrasingMarkdown(nodes: PhrasingContent[], s: Scope, start: number, end: number): string {
  const { src } = s;
  const [from, to] = s.leaf;
  const lineStart = lineStartOf(s.lines, start);
  // Back over the "> " markers and indentation before the span: the line starts there when that is all there is.
  let k = start;
  while (k > lineStart && /[ \t>]/.test(src[k - 1])) k--;
  const before = start > from && !(lineStart > from && k === lineStart);
  const after = end < to && src[end] !== "\n";
  // A text is written the same wherever it stands the same way (a report may repeat a refused URL thousands of times).
  const key = nodes.length === 1 && nodes[0].type === "text" ? `md ${+before}${+after}${+s.cell}${+s.label} ${nodes[0].value}` : null;
  let md = key === null ? undefined : s.memo.get(key);
  if (md === undefined) {
    md = writePhrasing(nodes, s, before, after);
    if (key !== null) s.memo.set(key, md);
  }
  if (md === null) {
    s.failed.value = true;
    return "";
  }
  return md.replace(/\n/g, `\n${s.prefix}`);
}

/** Phrasing as Markdown (see phrasingMarkdown), written as if text stood `before` and `after` it; null when that cannot be done. */
function writePhrasing(nodes: PhrasingContent[], s: Scope, before: boolean, after: boolean): string | null {
  const kids: PhrasingContent[] = [];
  const beside: PhrasingContent = { type: "text", value: BESIDE };
  for (const c of [...(before ? [beside] : []), ...nodes, ...(after ? [beside] : [])]) {
    const prev = kids[kids.length - 1];
    if (c.type === "text" && prev?.type === "text") kids[kids.length - 1] = { type: "text", value: prev.value + c.value };
    else if (c.type !== "text" || c.value) kids.push(c);
  }
  if (!kids.length) return "";
  const content: PhrasingContent[] = s.label ? [{ type: "link", url: "#", title: null, children: kids }] : kids;
  const root: Root = s.cell
    ? { type: "root", children: [{ type: "table", align: [null], children: [{ type: "tableRow", children: [{ type: "tableCell", children: content }] }] }] }
    : { type: "root", children: [{ type: "paragraph", children: content }] };
  let md: string | null = processor.stringify(root);
  md = s.cell ? unwrap(md.slice(0, md.indexOf("\n")), "| ", " |") : md.replace(/\n$/, "");
  if (s.label) md = unwrap(md, "[", "](#)");
  if (before) md = unwrap(md, BESIDE, "");
  if (after) md = unwrap(md, "", BESIDE);
  return md;
}

/** Where each line of `src` starts. */
function lineStarts(src: string): number[] {
  const out = [0];
  for (let i = src.indexOf("\n"); i >= 0; i = src.indexOf("\n", i + 1)) out.push(i + 1);
  return out;
}

/** The start of the line `at` is on, from `lines` (see lineStarts), by binary search. */
function lineStartOf(lines: number[], at: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lines[lo];
}

/** `text` without `head` and `tail`, or null when it does not have them. */
function unwrap(text: string | null, head: string, tail: string): string | null {
  return text !== null && text.length >= head.length + tail.length && text.startsWith(head) && text.endsWith(tail) ? text.slice(head.length, text.length - tail.length) : null;
}

/** Each changed block written anew in its place; raw HTML, now a paragraph, set apart from a block on the next line by a blank line. */
function flowEdits(items: Item[], s: Scope): SrcEdit[] {
  const edits: SrcEdit[] = [];
  items.forEach((it, i) => {
    if (!it.changed) {
      edits.push(...it.edits);
      return;
    }
    const [start, end] = spanOf(it.node, s);
    let text = it.out.length ? processor.stringify({ type: "root", children: it.out }).replace(/\n+$/, "").replace(/\n/g, `\n${s.prefix}`) : "";
    const at = it.node.position;
    const prev = items[i - 1]?.node.position;
    const next = items[i + 1]?.node.position;
    if (it.node.type === "html" && at) {
      if (prev && prev.end.line >= at.start.line - 1) text = `\n${s.prefix}${text}`;
      if (next && next.start.line <= at.end.line + 1) text = `${text}\n${s.prefix.trimEnd()}`;
    }
    edits.push({ start, end, text });
  });
  return edits;
}

/** The edits that write `src` as the file keeps it (see keepAllowed); `tree`, read from it, becomes what they mean. */
function exportEdits(tree: Root, src: string, ok: (url: string) => boolean, failed = { value: false }): SrcEdit[] {
  return keepAllowed(tree, { ok, labels: allowedLabels(tree, ok), src, lines: lineStarts(src), prefix: "", leaf: [0, src.length], cell: false, label: false, lead: false, write: true, memo: new Map(), failed });
}

/** The edits applied (they do not overlap) in one pass: the untouched spans and the edits' texts, in source order. */
function applyEdits(src: string, edits: SrcEdit[]): string {
  const parts: string[] = [];
  let pos = 0;
  for (const e of [...edits].sort((a, b) => a.start - b.start)) {
    if (e.start < pos || e.start > e.end) throw new Error("overlapping edits");
    parts.push(src.slice(pos, e.start), e.text);
    pos = e.end;
  }
  parts.push(src.slice(pos));
  return parts.join("");
}

const IGNORED_KEYS = new Set(["position", "spread", "data"]);

/** A link GFM's parser makes of URL or address text by itself ("https://…", "www.…", "a@b.c"): its text. */
function literalText(node: unknown): string | null {
  if (!node || typeof node !== "object" || (node as Nodes).type !== "link") return null;
  const { url, children } = node as Link;
  const text = children.length === 1 && children[0].type === "text" ? children[0].value : null;
  return text !== null && ((url === text && /^https?:\/\//i.test(url)) || url === `http://${text}` || url === `mailto:${text}`) ? text : null;
}

/** Children as their text reads (with `literal`, a literal link as its text), neighbouring text as one. */
function plainChildren(children: unknown[], literalAs: boolean): unknown[] {
  const out: unknown[] = [];
  for (const c of children) {
    const literal = literalAs ? literalText(c) : null;
    const node = literal !== null ? { type: "text", value: literal } : c;
    const prev = out[out.length - 1] as { type?: string; value?: string } | undefined;
    const isText = !!node && typeof node === "object" && (node as Nodes).type === "text";
    if (isText && prev?.type === "text") out[out.length - 1] = { type: "text", value: `${prev.value}${(node as Text).value}` };
    else if (!isText || (node as Text).value) out.push(node);
  }
  return out;
}

/**
 * Whether two trees say the same: positions and the looseness of lists aside, and with `literal`, a
 * literal link read as its text (GFM's parser links URL text again wherever it finds it, escaped or
 * not; the text itself is judged as text is, see unlinkRuns).
 */
function sameTree(a: unknown, b: unknown, literal: boolean): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    const [x, y] = [plainChildren(a, literal), plainChildren(b, literal)];
    return x.length === y.length && x.every((n, i) => sameTree(n, y[i], literal));
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return a === b;
  const entries = (o: object) => Object.entries(o).filter(([k, v]) => !IGNORED_KEYS.has(k) && v !== undefined);
  const ea = entries(a);
  return ea.length === entries(b).length && ea.every(([k, v]) => sameTree(v, (b as Record<string, unknown>)[k], literal));
}

/** Whether the file keeps all of `tree`, read from `md` by GFM's parser (`literal`) or plain CommonMark: nothing in it is left to change (see keepAllowed). */
function settled(tree: Root, md: string, ok: (url: string) => boolean, literal = true): boolean {
  const before = structuredClone(tree);
  exportEdits(tree, md, ok);
  return sameTree(tree, before, literal);
}

/** A destination a viewer resolves on its own site: no scheme, and not "//host" however written (WHATWG reads "\" as "/" and drops tabs and newlines). */
function onSite(url: string): boolean {
  const u = url.replace(/^[\x00-\x20]+/, "").replace(/[\t\n\r]/g, "").replace(/\\/g, "/");
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(u);
}

/** Whether `md` is settled as plain CommonMark reads it too (a viewer without GFM; a relative link there stays on its site). */
function plainSafe(md: string, ok: (url: string) => boolean): boolean {
  return settled(commonmark.parse(md) as Root, md, (url) => ok(url) || onSite(url), false);
}

/**
 * Report markdown for the .md file and Copy, keeping only the links `isLinkAllowed` allows (see
 * keepAllowed), and otherwise the report as written. Never throws: if the parser fails (e.g. on very
 * deep nesting), the text, reduced, is a code block, which no viewer renders as markup.
 */
export function markdownForExport(md: string, isLinkAllowed: (url: string) => boolean): string {
  const ok = (url: string) => {
    try {
      return isLinkAllowed(url);
    } catch {
      return false;
    }
  };
  try {
    const src = md.replace(/\r\n?/g, "\n");
    const tree = parseMarkdownTree(src);
    const failed = { value: false };
    const edits = exportEdits(tree, src, ok, failed);
    if (!failed.value) {
      // The edits must read as what they mean, and leave nothing to change, as either parser reads them.
      const out = applyEdits(src, edits);
      const back = edits.length ? parseMarkdownTree(out) : null;
      if ((!back || (sameTree(back, tree, true) && settled(back, out, ok))) && plainSafe(out, ok)) return out && !out.endsWith("\n") ? `${out}\n` : out;
    }
    // Written whole: `tree` is what the file keeps.
    const written = processor.stringify(tree);
    if (settled(parseMarkdownTree(written), written, ok) && plainSafe(written, ok)) return written;
  } catch {
    /* the code block below */
  }
  const text = unlinkText(md, ok);
  let fence = 3;
  for (const m of text.matchAll(/`+/g)) fence = Math.max(fence, m[0].length + 1);
  return `${"`".repeat(fence)}\n${text}\n${"`".repeat(fence)}\n`;
}

/** Text the file adds around the report (a source's line) as Markdown that reads as exactly that text on one line, each part linked to its href when it has one. */
export function inlineMarkdown(parts: readonly { text: string; href?: string | null }[]): string {
  return processor.stringify({ type: "root", children: [{ type: "paragraph", children: phrasingOf(parts) }] }).replace(/\n$/, "");
}

/** A title as a "# " heading that reads as exactly that text. */
export function headingMarkdown(title: string): string {
  return processor.stringify({ type: "root", children: [{ type: "heading", depth: 1, children: phrasingOf([{ text: title }]) }] }).replace(/\n$/, "");
}

/** The parts as text and links on one line, whitespace collapsed and trimmed at its ends. */
function phrasingOf(parts: readonly { text: string; href?: string | null }[]): PhrasingContent[] {
  const out = parts.map(({ text, href }, i): PhrasingContent => {
    let value = text.replace(/\s+/g, " ");
    if (i === 0) value = value.trimStart();
    if (i === parts.length - 1) value = value.trimEnd();
    return href ? { type: "link", url: href, title: null, children: value ? [{ type: "text", value }] : [] } : { type: "text", value };
  });
  return out.filter((c) => c.type !== "text" || c.value);
}

// ---------- Plain-text helpers ----------

export function inlinesToText(list: Inline[]): string {
  return list.map((i) => i.text).join("");
}

/** The report's own `# Title`, if the markdown opens with one. */
export function leadingTitle(blocks: Block[]): string | null {
  const first = blocks[0];
  return first && first.type === "heading" && first.depth === 1 ? inlinesToText(first.inlines).trim() || null : null;
}

/** Drop a leading `# Title` (the exporters print their own title). */
export function withoutLeadingTitle(blocks: Block[]): Block[] {
  return leadingTitle(blocks) !== null ? blocks.slice(1) : blocks;
}
