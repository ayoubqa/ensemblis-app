import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = {
  ...privateMetadata("Create your organization"),
  description: "Create your organization on Ensemblis — the AI operating layer for business.",
};

export default function SignupLayout({ children }: { children: ReactNode }) {
  return children;
}
