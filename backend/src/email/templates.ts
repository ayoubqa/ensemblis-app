// Branded, plain transactional email templates (inline styles only — email
// clients ignore <style> blocks and external CSS). Every template returns both
// an HTML and a plain-text version. All dynamic values are HTML-escaped.

import { config } from "../config";

const C = {
  bg: "#F4F6FB",
  surface: "#FFFFFF",
  ink: "#0A0F1E",
  muted: "#55607A",
  line: "#E1E6F0",
  accent: "#1F5BFF",
  accentInk: "#FFFFFF",
  accentSoft: "#E6EDFF",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

// What a mail client would turn into a link: URLs (scheme://…, protocol-relative //… or \\…, also to a
// bracketed IP address, www.…; trailing punctuation is the sentence's), mailto: and e-mail addresses (on
// a domain with a top-level domain: react@18.3.1 and deploy@10.0.0.5 have none). Each starts only where
// its run of characters does, or at the fixed "www." (linear time); "TCP//IP" is not a URL.
const URL_REST = String.raw`[^\s<>()[\]"'\x60]*[^\s<>()[\]"'\x60.,;:!?]`;
const LINKABLE = new RegExp(
  String.raw`(?:(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:|(?<![\p{L}\p{N}]))[\\/]{2}(?:\[[0-9a-f:.]+\](?:${URL_REST})?|${URL_REST})|www\.${URL_REST}|\bmailto:(?:${URL_REST})?|` +
    String.raw`(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:xn--[a-z0-9-]+|\p{L}{2,24})(?![\p{L}\p{N}-])`,
  "giu"
);

/**
 * `s` on one line without any URL or e-mail address, so a mail client has nothing in it to link
 * (for text an e-mail quotes: a report's summary, a model's question).
 */
const MAX_LINK_PASSES = 4;

export function withoutLinks(s: string): string {
  // "\0" marks where a URL or address was. A match can end where the next address's run starts
  // ("a@one.example+b@other.example"), and dropping a mark joins the text on either side ("www" +
  // mark + ".host/path"), so repeat until a pass changes nothing: each later pass removes one or more.
  // Each pass can uncover only one more nesting level, so the passes are capped (keeping this linear);
  // text still link-shaped after the cap is dropped rather than sent.
  let text = s;
  for (let prev = "", pass = 0; prev !== text; pass++) {
    if (pass === MAX_LINK_PASSES) return text.search(LINKABLE) === -1 && !text.includes("\0") ? text : "";
    prev = text;
    text = text
      .replace(LINKABLE, "\0")
      .replace(/\s+/g, " ")
      // ...which leaves no empty "()", no space before punctuation, one space between words.
      .replace(/\( ?\0[ \0]*\)/g, "\0")
      .replace(/ ?\0[ \0]*(?=[.,;:!?]|$)/g, "")
      .replace(/ ?\0[ \0]*/g, " ")
      .trim();
  }
  return text;
}

/**
 * Strips inline markdown (bold, links, code, citations) to plain text, without any URL or
 * e-mail address: the summary goes out in an e-mail, where nothing of the report is a link.
 */
function plainInline(s: string): string {
  return withoutLinks(
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> text
      .replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "") // citation markers [1], [2,3]
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(.+?)\1/g, "$2")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/<(?:[a-z][a-z0-9+.-]{1,31}:|[^\s<>@]+@)[^\s<>]*>/gi, "\0") // autolinks
      .replace(/<[^>]+>/g, "")
  );
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, "") + "…";
}

/** clip() can cut a word into something link-shaped ("x@host.com-2024" → "x@host.com…"), so strip after it too. */
function clipPlain(s: string, max: number): string {
  return withoutLinks(clip(s, max));
}

/** Each line without a URL or address, keeping the lines and the spacing of those that had none. */
function linkFreeLines(s: string): string {
  // A "\0" line is cleaned too: an HTML parser drops NUL, joining the text around it.
  return s
    .split("\n")
    .map((line) => (line.includes("\0") || line.search(LINKABLE) !== -1 ? withoutLinks(line) : line))
    .join("\n");
}

/**
 * The first `maxLines` points of a report's executive summary as plain text
 * (falls back to the first paragraph lines when there is no such section).
 */
export function summarizeReport(markdown: string | null | undefined, maxLines = 3, maxChars = 220): string[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,4}\s*(executive\s+summary|summary|tl;?dr|key\s+findings)\b/i.test(l.trim()));
  const pick: string[] = [];
  if (start !== -1) {
    for (let i = start + 1; i < lines.length && pick.length < maxLines; i++) {
      const l = lines[i].trim();
      if (/^#{1,6}\s/.test(l)) break; // next section
      if (!l || /^\|/.test(l) || /^-{3,}$/.test(l)) continue;
      const text = plainInline(l.replace(/^([-*+]|\d+[.)])\s+/, ""));
      if (text) pick.push(clipPlain(text, maxChars));
    }
  }
  if (pick.length === 0) {
    for (const raw of lines) {
      if (pick.length >= maxLines) break;
      const l = raw.trim();
      if (!l || /^#{1,6}\s/.test(l) || /^\|/.test(l) || /^-{3,}$/.test(l) || /^>/.test(l)) continue;
      const text = plainInline(l.replace(/^([-*+]|\d+[.)])\s+/, ""));
      if (text) pick.push(clipPlain(text, maxChars));
    }
  }
  return pick;
}

interface Layout {
  preheader: string;
  heading: string;
  paragraphs: string[]; // already-escaped HTML fragments
  bullets?: string[]; // plain text, escaped here
  button?: { label: string; url: string };
  footnote?: string; // plain text
  footer: "task" | "account";
}

function layout(l: Layout): string {
  const p = (html: string) =>
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${C.ink};font-family:${FONT}">${html}</p>`;
  const bullets = l.bullets?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 18px;background:${C.accentSoft};border-radius:10px"><tr><td style="padding:14px 18px">` +
      l.bullets
        .map(
          (b) =>
            `<p style="margin:6px 0;font-size:14px;line-height:1.5;color:${C.ink};font-family:${FONT}">&#8226;&nbsp; ${escapeHtml(b)}</p>`
        )
        .join("") +
      `</td></tr></table>`
    : "";
  const button = l.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr><td style="border-radius:9px;background:${C.accent}">` +
      `<a href="${escapeHtml(l.button.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:${C.accentInk};text-decoration:none;font-family:${FONT};border-radius:9px">${escapeHtml(l.button.label)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:${C.muted};font-family:${FONT};word-break:break-all">Or open this link: <a href="${escapeHtml(l.button.url)}" style="color:${C.accent}">${escapeHtml(l.button.url)}</a></p>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(l.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(l.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.bg}"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px">
<tr><td style="padding:0 4px 16px;font-family:${FONT};font-size:16px;font-weight:700;color:${C.ink}">
<span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:6px;background:${C.accent};color:${C.accentInk};font-size:13px;margin-right:8px;vertical-align:middle">E</span><span style="vertical-align:middle">Ensemblis</span>
</td></tr>
<tr><td style="background:${C.surface};border:1px solid ${C.line};border-radius:14px;padding:28px 26px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${C.ink};font-family:${FONT}">${escapeHtml(l.heading)}</h1>
${l.paragraphs.map(p).join("\n")}
${bullets}
${button}
${l.footnote ? `<p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:${C.muted};font-family:${FONT}">${escapeHtml(l.footnote)}</p>` : ""}
</td></tr>
<tr><td style="padding:16px 4px 0;font-size:12px;line-height:1.5;color:${C.muted};font-family:${FONT}">
${
  l.footer === "task"
    ? `You're receiving this because you work on objectives in Ensemblis. You can turn these emails off in your settings: <a href="${escapeHtml(config.appUrl)}/settings" style="color:${C.accent}">${escapeHtml(config.appUrl.replace(/^https?:\/\//, ""))}/settings</a>`
    : "You're receiving this because a request was made for your Ensemblis account."
}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function taskCompletedEmail(args: { name: string; taskId: string; title: string; result: string | null }): RenderedEmail {
  const url = `${config.appUrl}/tasks/${encodeURIComponent(args.taskId)}`;
  const summary = summarizeReport(args.result, 3);
  // A title can be a model's text (the planner names an objective): no e-mail links anything in it.
  const plainTitle = withoutLinks(args.title);
  const title = clipPlain(plainTitle, 120);
  const subject = `Your report is ready: ${clipPlain(plainTitle, 70)}`;
  const html = layout({
    preheader: summary[0] ?? "Your AI agent team has finished your task.",
    heading: "Your report is ready",
    paragraphs: [
      `Hi ${escapeHtml(args.name || "there")},`,
      `Your agent team finished <strong>${escapeHtml(title)}</strong>.${summary.length ? " Here's the gist:" : ""}`,
    ],
    bullets: summary,
    button: { label: "Open the full report", url },
    footnote: "AI-generated content can contain mistakes. Check important facts before relying on them.",
    footer: "task",
  });
  const text = [
    `Hi ${args.name || "there"},`,
    "",
    `Your agent team finished "${title}".`,
    ...(summary.length ? ["", ...summary.map((s) => `- ${s}`)] : []),
    "",
    `Open the full report: ${url}`,
    "",
    "AI-generated content can contain mistakes. Check important facts before relying on them.",
    "",
    `Turn off task emails: ${config.appUrl}/settings`,
  ].join("\n");
  return { subject, html, text };
}

export function taskFailedEmail(args: { name: string; taskId: string; title: string; refundedCents: number }): RenderedEmail {
  const url = `${config.appUrl}/tasks/${encodeURIComponent(args.taskId)}`;
  const plainTitle = withoutLinks(args.title);
  const title = clipPlain(plainTitle, 120);
  const refund =
    args.refundedCents > 0
      ? `We refunded the full ${eur(args.refundedCents)} to the wallet that paid for it.`
      : "You were not charged for it.";
  const subject = `Your task couldn't be completed: ${clipPlain(plainTitle, 60)}`;
  const html = layout({
    preheader: `${refund} You can retry it in one click.`,
    heading: "Your task couldn't be completed",
    paragraphs: [
      `Hi ${escapeHtml(args.name || "there")},`,
      `Something went wrong while the agent team worked on <strong>${escapeHtml(title)}</strong>. ${escapeHtml(refund)}`,
      "You can open the task to see what happened and retry it.",
    ],
    button: { label: "View task", url },
    footer: "task",
  });
  const text = [
    `Hi ${args.name || "there"},`,
    "",
    `Something went wrong while the agent team worked on "${title}". ${refund}`,
    "You can open the task to see what happened and retry it.",
    "",
    `View task: ${url}`,
    "",
    `Turn off task emails: ${config.appUrl}/settings`,
  ].join("\n");
  return { subject, html, text };
}

export function passwordResetEmail(args: { name: string; resetUrl: string; expiresMinutes: number }): RenderedEmail {
  const subject = "Reset your Ensemblis password";
  const html = layout({
    preheader: `This link expires in ${args.expiresMinutes} minutes.`,
    heading: "Reset your password",
    paragraphs: [
      `Hi ${escapeHtml(args.name || "there")},`,
      `Someone (hopefully you) asked to reset the password for your Ensemblis account. The link below works once and expires in ${args.expiresMinutes} minutes.`,
    ],
    button: { label: "Choose a new password", url: args.resetUrl },
    footnote: "Didn't ask for this? You can safely ignore this email — your password won't change.",
    footer: "account",
  });
  const text = [
    `Hi ${args.name || "there"},`,
    "",
    `Someone (hopefully you) asked to reset the password for your Ensemblis account. The link below works once and expires in ${args.expiresMinutes} minutes.`,
    "",
    `Choose a new password: ${args.resetUrl}`,
    "",
    "Didn't ask for this? You can safely ignore this email — your password won't change.",
  ].join("\n");
  return { subject, html, text };
}

// ---------------------------------------------------------------- v4: objectives

const objectiveUrl = (objectiveId: string) => `${config.appUrl}/objectives/${encodeURIComponent(objectiveId)}`;

export function outcomeReadyEmail(args: {
  name: string;
  objectiveId: string;
  title: string;
  result: string | null;
  outcomeLabel: string;
  verificationLabel: string;
}): RenderedEmail {
  const url = objectiveUrl(args.objectiveId);
  const summary = summarizeReport(args.result, 3);
  const plainTitle = withoutLinks(args.title);
  const title = clipPlain(plainTitle, 120);
  const subject = `Outcome ready: ${clipPlain(plainTitle, 70)}`;
  const html = layout({
    preheader: `${args.outcomeLabel} · ${args.verificationLabel}`,
    heading: "Your outcome is ready",
    paragraphs: [
      `Hi ${escapeHtml(args.name || "there")},`,
      `Ensemblis finished <strong>${escapeHtml(title)}</strong>. Outcome: <strong>${escapeHtml(args.outcomeLabel)}</strong>. Verification: ${escapeHtml(args.verificationLabel)}.`,
    ],
    bullets: summary,
    button: { label: "Open the outcome", url },
    footnote: "AI-generated work can contain mistakes. Review the evidence and verification before relying on it.",
    footer: "task",
  });
  const text = [
    `Hi ${args.name || "there"},`,
    "",
    `Ensemblis finished "${title}". Outcome: ${args.outcomeLabel}. Verification: ${args.verificationLabel}.`,
    ...(summary.length ? ["", ...summary.map((x) => `- ${x}`)] : []),
    "",
    `Open the outcome: ${url}`,
    "",
    `Turn off these emails: ${config.appUrl}/settings`,
  ].join("\n");
  return { subject, html, text };
}

export function attentionEmail(args: { name: string; objectiveId: string; title: string; headline: string; detail: string }): RenderedEmail {
  const url = objectiveUrl(args.objectiveId);
  const plainTitle = withoutLinks(args.title);
  const title = clipPlain(plainTitle, 120);
  const subject = `Needs your attention: ${clipPlain(plainTitle, 60)}`;
  // The detail may be a model's text (the planner's question, a step's title): it links nothing. It
  // keeps its lines (a question can list options); a line without a URL or an address stays as written.
  const detail = linkFreeLines(clip(linkFreeLines(args.detail), 400));
  const html = layout({
    preheader: args.headline,
    heading: args.headline,
    paragraphs: [`Hi ${escapeHtml(args.name || "there")},`, `<strong>${escapeHtml(title)}</strong>: ${escapeHtml(detail)}`],
    button: { label: "Review it", url },
    footer: "task",
  });
  const text = [`Hi ${args.name || "there"},`, "", `${args.headline}`, `"${title}": ${detail}`, "", `Review it: ${url}`].join("\n");
  return { subject, html, text };
}

export function executionFailedEmail(args: { name: string; objectiveId: string; title: string; refundedCents: number; reason: string }): RenderedEmail {
  const url = objectiveUrl(args.objectiveId);
  const plainTitle = withoutLinks(args.title);
  const title = clipPlain(plainTitle, 120);
  const refund = args.refundedCents > 0 ? `We refunded ${eur(args.refundedCents)} to your organization's balance.` : "You were not charged for it.";
  const subject = `Execution stopped: ${clipPlain(plainTitle, 60)}`;
  const html = layout({
    preheader: refund,
    heading: "An execution couldn't be completed",
    paragraphs: [
      `Hi ${escapeHtml(args.name || "there")},`,
      `Ensemblis couldn't complete <strong>${escapeHtml(title)}</strong>: ${escapeHtml(clip(args.reason, 300))} ${escapeHtml(refund)}`,
      "You can open the objective to see exactly what happened and run it again.",
    ],
    button: { label: "Open the objective", url },
    footer: "task",
  });
  const text = [`Hi ${args.name || "there"},`, "", `Ensemblis couldn't complete "${title}": ${clip(args.reason, 300)} ${refund}`, "", `Open the objective: ${url}`].join("\n");
  return { subject, html, text };
}

export function verifyEmailEmail(args: { name: string; verifyUrl: string; expiresHours: number }): RenderedEmail {
  const subject = "Confirm your email for Ensemblis";
  const html = layout({
    preheader: `This link expires in ${args.expiresHours} hours.`,
    heading: "Confirm your email address",
    paragraphs: [`Hi ${escapeHtml(args.name || "there")},`, `Confirm that this address belongs to you. The link works once and expires in ${args.expiresHours} hours.`],
    button: { label: "Confirm my email", url: args.verifyUrl },
    footnote: "Didn't create an Ensemblis account? You can ignore this email.",
    footer: "account",
  });
  const text = [`Hi ${args.name || "there"},`, "", `Confirm your email address: ${args.verifyUrl}`, "", `The link expires in ${args.expiresHours} hours.`].join("\n");
  return { subject, html, text };
}
