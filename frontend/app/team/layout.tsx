import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = {
  ...privateMetadata("Organization members"),
  description: "Invite colleagues into your organization: shared Company Context, objectives, AI Team and balance.",
};

export default function TeamLayout({ children }: { children: ReactNode }) {
  return children;
}
