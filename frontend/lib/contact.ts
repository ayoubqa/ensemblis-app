// The operator's public contact address (NEXT_PUBLIC_CONTACT_EMAIL, inlined at build time). Plain module — no
// "use client" — so server components (blog, access page) and client components (legal pages) share it.
export const CONTACT_EMAIL = (process.env.NEXT_PUBLIC_CONTACT_EMAIL || "").trim();

/** A mailto: link with a subject and body, or null when no contact address is configured. */
export function mailto(subject: string, body = ""): string | null {
  if (!CONTACT_EMAIL) return null;
  const q = [`subject=${encodeURIComponent(subject)}`, body ? `body=${encodeURIComponent(body)}` : ""].filter(Boolean).join("&");
  return `mailto:${CONTACT_EMAIL}?${q}`;
}
