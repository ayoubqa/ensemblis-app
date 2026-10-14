import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = privateMetadata("Settings");

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
