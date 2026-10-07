import type { AttachmentKind } from "@/lib/api";
import { Icon } from "@/components";
import s from "./attachments.module.css";

const LABEL: Record<AttachmentKind, string> = { pdf: "PDF", docx: "DOC", xlsx: "XLS", csv: "CSV", txt: "TXT", md: "MD", url: "" };

/** Colored file-type tile: PDF / DOC / XLS / CSV / TXT / MD, or a link glyph for web pages. Decorative. */
export function FileBadge({ kind, small }: { kind: AttachmentKind; small?: boolean }) {
  return (
    <span className={`${s.badge} ${s[`k-${kind}`]}${small ? ` ${s.sm}` : ""}`} aria-hidden="true">
      {kind === "url" ? <Icon name="link" size={small ? 13 : 17} /> : LABEL[kind]}
    </span>
  );
}
