"use client";

import { useConfig } from "@/lib/config";
import { Icon } from "./Icon";

/**
 * Small "Sample data" marker shown next to seeded catalog stats (ratings,
 * success rates, task counts) when the server reports `sampleCatalogStats`.
 * Renders nothing otherwise.
 */
export function SampleTag({ label = "Sample data", note, style }: { label?: string; note?: string; style?: React.CSSProperties }) {
  const { config } = useConfig();
  if (!config.sampleCatalogStats) return null;
  const tip = note ?? "Ratings, success rates and task counts in the agent catalog are illustrative sample figures, not measured results from this demo.";
  return (
    <span className="sampletag" title={tip} style={style}>
      <Icon name="info" />
      {label}
      <span className="sr-only">: {tip}</span>
    </span>
  );
}

export default SampleTag;
