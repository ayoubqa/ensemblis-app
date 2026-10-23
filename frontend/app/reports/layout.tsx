import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("Reports");

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return children;
}
