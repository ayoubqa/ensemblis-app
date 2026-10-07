// Branded, plain transactional email templates (inline styles only — email
// clients ignore <style> blocks and external CSS). Every template returns both
// an HTML and a plain-text version. All dynamic values are HTML-escaped.

import { config } from "../config";

const C = {
  bg: "#F4F5F2",
  surface: "#FFFFFF",
  ink: "#12181B",
  muted: "#5A6567",
  line: "#E1E4DF",
  accent: "#0B5D57",
  accentInk: "#FFFFFF",
  accentSoft: "#E2EFEC",
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

/** Strips inline markdown (bold, links, code, citations) to plain text. */
function plainInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, "") // citation markers [1], [2,3]
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, "") + "…";
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
      if (text) pick.push(clip(text, maxChars));
    }
  }
  if (pick.length === 0) {
    for (const raw of lines) {
      if (pick.length >= maxLines) break;
      const l = raw.trim();
      if (!l || /^#{1,6}\s/.test(l) || /^\|/.test(l) || /^-{3,}$/.test(l) || /^>/.test(l)) continue;
      const text = plainInline(l.replace(/^([-*+]|\d+[.)])\s+/, ""));
      if (text) pick.push(clip(text, maxChars));
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
    ? `You're receiving this because you started a task on Ensemblis. You can turn off task emails in your settings: <a href="${escapeHtml(config.appUrl)}/settings" style="color:${C.accent}">${escapeHtml(config.appUrl.replace(/^https?:\/\//, ""))}/settings</a>`
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
  const title = clip(args.title, 120);
  const subject = `Your report is ready: ${clip(args.title, 70)}`;
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
  const title = clip(args.title, 120);
  const refund =
    args.refundedCents > 0
      ? `We refunded the full ${eur(args.refundedCents)} to the wallet that paid for it.`
      : "You were not charged for it.";
  const subject = `Your task couldn't be completed: ${clip(args.title, 60)}`;
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
