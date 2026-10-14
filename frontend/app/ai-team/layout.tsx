import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("AI Team");

export default function AITeamLayout({ children }: { children: ReactNode }) {
  return children;
}
