// Company Context: stable knowledge about the business, reused by every
// objective so nobody has to repeat it. Organization-scoped.
//
// The profile fields are entered by the organization ("user_provided" data).
// Documents and the website are UNTRUSTED data: they are quoted to agents as
// material to analyse, never as instructions (see engine/prompts.ts).

import type { CompanyContext, ContextDocument } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { HttpError } from "../lib/http";
import { fetchUrl, FetchUrlError } from "../research/fetchUrl";
import { cleanText, collapse, truncateChars } from "../research/text";
import { keywordRetriever, type Passage, type Retriever } from "./retrieval";

export const MAX_CONTEXT_DOCUMENTS = 25;
const WEBSITE_CHARS = 8000;

export const PROFILE_FIELDS = [
  { key: "companyName", label: "Company", max: 160 },
  { key: "description", label: "What the company does", max: 4000 },
  { key: "products", label: "Products & services", max: 4000 },
  { key: "businessModel", label: "Business model", max: 2000 },
  { key: "customers", label: "Customers / ICP", max: 4000 },
  { key: "markets", label: "Markets & geographies", max: 2000 },
  { key: "goals", label: "Business goals", max: 4000 },
  { key: "website", label: "Website", max: 2048 },
] as const;
export type ProfileKey = (typeof PROFILE_FIELDS)[number]["key"];
export type ProfilePatch = Partial<Record<ProfileKey, string>>;

export async function getCompanyContext(orgId: string): Promise<CompanyContext> {
  return prisma.companyContext.upsert({ where: { orgId }, update: {}, create: { orgId } });
}

export async function updateCompanyContext(orgId: string, userId: string, patch: ProfilePatch): Promise<CompanyContext> {
  const data: Record<string, string> = {};
  for (const f of PROFILE_FIELDS) {
    const v = patch[f.key];
    if (v === undefined) continue;
    data[f.key] = truncateChars(cleanText(v).trim(), f.max);
  }
  if (data.website) {
    const w = data.website.trim();
    const withScheme = /^https?:\/\//i.test(w) ? w : `https://${w}`;
    try {
      const u = new URL(withScheme);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad protocol");
      data.website = u.toString();
    } catch {
      throw new HttpError(400, "website: Enter a valid web address, e.g. https://example.com");
    }
  }
  const before = await getCompanyContext(orgId);
  const websiteChanged = data.website !== undefined && data.website !== before.website;
  return prisma.companyContext.update({
    where: { orgId },
    data: { ...data, updatedById: userId, ...(websiteChanged ? { websiteSummary: "", websiteFetchedAt: null } : {}) },
  });
}

/** Fetches the company website (SSRF-safe) and stores its readable text. */
export async function refreshWebsite(orgId: string): Promise<CompanyContext> {
  const ctx = await getCompanyContext(orgId);
  if (!ctx.website) throw new HttpError(400, "Add your website address first.");
  let page;
  try {
    page = await fetchUrl(ctx.website);
  } catch (err) {
    if (err instanceof FetchUrlError) throw new HttpError(400, err.message);
    throw new HttpError(400, "We couldn't read that website. Check the address and try again.");
  }
  const text = truncateChars(cleanText(page.text).trim(), WEBSITE_CHARS);
  if (!text) throw new HttpError(400, "We couldn't find readable text on that website.");
  return prisma.companyContext.update({ where: { orgId }, data: { websiteSummary: text, websiteFetchedAt: new Date() } });
}

export function contextCompleteness(ctx: CompanyContext): { filled: number; total: number; missing: string[] } {
  const keys: ProfileKey[] = ["companyName", "description", "products", "customers", "markets", "goals"];
  const missing = keys.filter((k) => !String(ctx[k] ?? "").trim());
  const labels = new Map(PROFILE_FIELDS.map((f) => [f.key, f.label]));
  return { filled: keys.length - missing.length, total: keys.length, missing: missing.map((k) => labels.get(k) ?? k) };
}

/** The company profile as a prompt block (user-provided data). Empty fields are omitted. */
export function formatCompanyProfile(ctx: CompanyContext | null): string {
  if (!ctx) return "";
  const lines: string[] = [];
  for (const f of PROFILE_FIELDS) {
    if (f.key === "website") continue;
    const v = String(ctx[f.key] ?? "").trim();
    if (v) lines.push(`${f.label}: ${v}`);
  }
  if (ctx.website) lines.push(`Website: ${ctx.website}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- documents

export function sanitizeDocumentText(raw: string, maxChars = config.attachments.maxChars): string {
  return truncateChars(cleanText(raw).trim(), maxChars).trim();
}

const docName = (raw: string) => truncateChars(collapse(raw), 200).trim();

async function assertRoom(orgId: string) {
  const n = await prisma.contextDocument.count({ where: { orgId } });
  if (n >= MAX_CONTEXT_DOCUMENTS) {
    throw new HttpError(409, `Your organization can keep up to ${MAX_CONTEXT_DOCUMENTS} documents. Remove one before adding another.`);
  }
}

export async function addTextDocument(orgId: string, userId: string, input: { kind: string; name: string; text: string }) {
  const name = docName(input.name);
  if (!name) throw new HttpError(400, "name: File name is required");
  const text = sanitizeDocumentText(input.text);
  if (!text) throw new HttpError(400, "We couldn't find any readable text in this file.");
  await assertRoom(orgId);
  return prisma.contextDocument.create({
    data: { orgId, kind: input.kind, name, url: null, charCount: text.length, text, createdById: userId },
  });
}

export async function addLinkDocument(orgId: string, userId: string, url: string) {
  await assertRoom(orgId);
  let page;
  try {
    page = await fetchUrl(url);
  } catch (err) {
    if (err instanceof FetchUrlError) throw new HttpError(400, err.message);
    throw new HttpError(400, "We couldn't fetch that page. Try again, or upload the text as a file instead.");
  }
  const text = sanitizeDocumentText(page.text);
  if (!text) throw new HttpError(400, "We couldn't find any readable text on that page.");
  const name = docName(page.title) || docName(new URL(page.finalUrl).hostname) || "Linked page";
  return prisma.contextDocument.create({
    data: { orgId, kind: "url", name, url: page.finalUrl, charCount: text.length, text, createdById: userId },
  });
}

export async function deleteDocument(orgId: string, id: string) {
  const removed = await prisma.contextDocument.deleteMany({ where: { id, orgId } });
  if (removed.count === 0) throw new HttpError(404, "Document not found");
}

export function toPublicDocument(d: Pick<ContextDocument, "id" | "kind" | "name" | "url" | "charCount" | "createdAt">) {
  return { id: d.id, kind: d.kind, name: d.name, url: d.url, charCount: d.charCount, createdAt: d.createdAt.toISOString() };
}

/** Most relevant document passages for a query (org-scoped). */
export async function retrievePassages(orgId: string, query: string, k = 4, retriever: Retriever = keywordRetriever): Promise<Passage[]> {
  const docs = await prisma.contextDocument.findMany({
    where: { orgId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, kind: true, url: true, text: true },
  });
  return retriever.retrieve(docs, query, k);
}
