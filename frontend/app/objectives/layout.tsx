import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE, privateMetadata } from "@/lib/site";

// A plain string title here would drop the root "%s · Ensemblis" template for the
// segments below (/objectives/new, /objectives/[id]), so pass it on explicitly.
export const metadata: Metadata = { ...privateMetadata("Objectives"), title: { default: "Objectives", template: `%s · ${SITE.name}` } };

export default function ObjectivesLayout({ children }: { children: ReactNode }) {
  return children;
}
