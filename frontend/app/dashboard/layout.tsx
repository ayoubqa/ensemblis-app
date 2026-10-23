import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("Chief of Staff");

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return children;
}
