import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Create your organization on Ensemblis — the AI operating layer for business.",
};

export default function SignupLayout({ children }: { children: ReactNode }) {
  return children;
}
