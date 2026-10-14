import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("Define an outcome");

export default function DefineOutcomeLayout({ children }: { children: ReactNode }) {
  return children;
}
