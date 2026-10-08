import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("Recurring objectives");

export default function RoutinesLayout({ children }: { children: ReactNode }) {
  return children;
}
