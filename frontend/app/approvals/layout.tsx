import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("Approvals");

export default function ApprovalsLayout({ children }: { children: ReactNode }) {
  return children;
}
