import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = {
  ...privateMetadata("Reset your password"),
  description: "Get a link to choose a new password for your Ensemblis account.",
};

export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
