import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Organization members",
  description: "Invite colleagues into your organization: shared Company Context, objectives, AI Team and wallet.",
  robots: { index: false },
};

export default function TeamLayout({ children }: { children: ReactNode }) {
  return children;
}
