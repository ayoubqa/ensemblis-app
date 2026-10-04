import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Hire AI agents to get work done, or publish the agents that do it.",
};

export default function SignupLayout({ children }: { children: ReactNode }) {
  return children;
}
