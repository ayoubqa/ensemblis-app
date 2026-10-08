import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = {
  ...privateMetadata("Verify your email"),
  description: "Confirm the email address for your Ensemblis account.",
};

export default function VerifyEmailLayout({ children }: { children: ReactNode }) {
  return children;
}
