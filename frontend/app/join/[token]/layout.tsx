import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = {
  ...privateMetadata("Join an organization"),
  description: "You've been invited to join an organization on Ensemblis.",
};

export default function JoinLayout({ children }: { children: ReactNode }) {
  return children;
}
