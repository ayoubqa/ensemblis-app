import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("Exceptions");

export default function ExceptionsLayout({ children }: { children: ReactNode }) {
  return children;
}
