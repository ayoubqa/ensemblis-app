import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Team",
  description: "Share one credit wallet and one task history with your colleagues.",
  robots: { index: false },
};

export default function TeamLayout({ children }: { children: ReactNode }) {
  return children;
}
