import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = { ...privateMetadata("Log in"), description: "Log in to your Ensemblis account." };

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
