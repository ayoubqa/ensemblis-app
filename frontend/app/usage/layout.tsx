import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("Usage");

export default function UsageLayout({ children }: { children: ReactNode }) {
  return children;
}
