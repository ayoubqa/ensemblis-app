// Brand constants for the PDF / Word exporters (files that leave the browser
// cannot read CSS variables). Values mirror app/styles/tokens.css — the official
// Ensemblis palette, with the print-safe derived blue/slate used for small text
// on white. Tiny on purpose: export-pdf/export-docx import it, pages must not
// import those exporters statically.

export const BRAND = {
  ink: "07111F", // --ens-ink
  navy: "0B1730", // --ens-navy
  blue: "1677FF", // --ens-blue
  blueText: "0B63E6", // --ens-blue-text (AA on white)
  slate: "4F5F73", // light --muted (AA on white)
  line: "E1E8F0", // light --line
  soft: "F6F8FB", // --ens-slate-50
  code: "EAF0F7", // --ens-slate-100
} as const;

/** The official mark, resized proportionally (public/brand). Never redrawn. */
export const BRAND_MARK_URL = "/brand/ensemblis-mark-128.png";

/** Fetch the official mark for embedding in an export. Resolves to null when unavailable. */
export async function loadBrandMark(as: "dataUrl"): Promise<string | null>;
export async function loadBrandMark(as: "bytes"): Promise<Uint8Array | null>;
export async function loadBrandMark(as: "dataUrl" | "bytes"): Promise<string | Uint8Array | null> {
  try {
    const res = await fetch(BRAND_MARK_URL);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (as === "bytes") return new Uint8Array(await blob.arrayBuffer());
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
