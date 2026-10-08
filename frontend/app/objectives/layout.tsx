import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("Objectives");

export default function ObjectivesLayout({ children }: { children: ReactNode }) {
  return children;
}
