// Shared report rendering + export (v3). Heavy export libraries (pdfmake, docx)
// are only loaded on click from <ExportMenu>; don't import export-pdf/export-docx
// statically from pages.
export { ReportView, splitReport, reportTitle, type ReportViewProps, type ReportSection } from "./ReportView";
export { ReportMarkdown, CitedMarkdown, CiteProvider, sourceDomId } from "./ReportMarkdown";
export { SourcesPanel, type SourcesPanelProps } from "./SourcesPanel";
export { ExportMenu, type ExportMenuProps } from "./ExportMenu";
export {
  AI_NOTE,
  EVIDENCE_KIND_LABEL,
  KIND_LABEL,
  LEGACY_NOTE,
  buildMarkdownFile,
  copyText,
  depthLabel,
  fileSlug,
  hostOf,
  plainSummary,
  prettyDate,
  safeHref,
  saveBlob,
  sortSources,
  sourceDomain,
  sourceInitial,
  sourceLabel,
  type ExportInput,
  type LabelledSource,
  type ExportMeta,
} from "./shared";
