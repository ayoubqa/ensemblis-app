// Turns a fetched HTML page into readable plain text for the agents:
// drops scripts/styles/navigation/footers/asides/forms, prefers the
// <article>/<main> region, keeps headings, paragraphs, list items and table
// rows, and collapses whitespace.

import { load } from "cheerio";
import { collapse, tidyText } from "./text";

type CheerioAPI = ReturnType<typeof load>;

const DROP =
  "script, style, noscript, template, iframe, object, embed, svg, canvas, video, audio, " +
  "nav, footer, aside, form, button, select, input, textarea, dialog, " +
  "[role=navigation], [role=contentinfo], [role=complementary], [role=search], [hidden], [aria-hidden=true]";

const BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, tr, pre, blockquote, dt, dd, figcaption, caption";

export interface ExtractedPage {
  title: string;
  text: string;
}

function pickTitle($: CheerioAPI): string {
  const candidates = [
    $('meta[property="og:title"]').attr("content"),
    $("title").first().text(),
    $("h1").first().text(),
  ];
  for (const c of candidates) {
    const t = collapse(c ?? "");
    if (t) return t.slice(0, 200);
  }
  return "";
}

export function extractReadableText(html: string): ExtractedPage {
  const $ = load(html);
  const title = pickTitle($);
  $(DROP).remove();

  // Prefer the main content region when there is one with real text in it.
  // load() always builds <html><body>, even for fragments.
  const body = $("body").first();
  let root = body;
  let best = 0;
  $("article, main, [role=main]").each((_, el) => {
    const len = collapse($(el).text()).length;
    if (len > best) {
      best = len;
      root = $(el);
    }
  });
  if (best < 200) root = body;

  const blocks: { tag: string; text: string }[] = [];
  root.find(BLOCKS).each((_, el) => {
    const $el = $(el);
    // Emit the outermost block only (an <li> containing a <p> is emitted once).
    if ($el.parentsUntil(root).filter(BLOCKS).length > 0) return;
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "p";
    let text: string;
    if (tag === "tr") {
      text = $el
        .children("th, td")
        .map((__, cell) => collapse($(cell).text()))
        .get()
        .filter(Boolean)
        .join(" | ");
    } else if (tag === "pre") {
      text = tidyText($el.text());
    } else {
      text = collapse($el.text());
    }
    if (!text) return;
    if (/^h[1-6]$/.test(tag)) text = `${"#".repeat(Number(tag[1]))} ${text}`;
    else if (tag === "li") text = `- ${text}`;
    const prev = blocks[blocks.length - 1];
    if (prev && prev.text === text) return; // repeated block (e.g. duplicated teaser)
    blocks.push({ tag, text });
  });

  let text = "";
  for (let i = 0; i < blocks.length; i++) {
    if (i > 0) {
      const a = blocks[i - 1].tag;
      const b = blocks[i].tag;
      text += (a === b && (a === "li" || a === "tr")) ? "\n" : "\n\n";
    }
    text += blocks[i].text;
  }

  // Pages built from <div>s only: fall back to the region's text with line
  // breaks at block boundaries.
  const full = collapse(root.text());
  if (text.length < 200 || text.length < full.length * 0.25) {
    root.find("br").replaceWith("\n");
    root.find("div, section, article, header, p, li, tr, h1, h2, h3, h4, h5, h6, ul, ol, table, pre, blockquote").each((_, el) => {
      $(el).append("\n");
    });
    const lines = root
      .text()
      .split("\n")
      .map((l) => collapse(l))
      .filter(Boolean);
    const fallback = lines.join("\n");
    if (fallback.length > text.length) text = fallback;
  }

  return { title, text: tidyText(text) };
}

/** Plain-text documents: just clean and tidy. */
export function extractPlainText(body: string): ExtractedPage {
  return { title: "", text: tidyText(body) };
}
