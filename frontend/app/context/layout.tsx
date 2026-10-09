import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("Company Context");

export default function ContextLayout({ children }: { children: ReactNode }) {
  return children;
}
