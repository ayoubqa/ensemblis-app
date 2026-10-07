import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Join a team",
  description: "You've been invited to a team on Ensemblis.",
  robots: { index: false },
};

export default function JoinLayout({ children }: { children: ReactNode }) {
  return children;
}
