import type { Metadata } from "next";
import type { ReactNode } from "react";
import { privateMetadata } from "@/lib/site";

export const metadata: Metadata = {
  ...privateMetadata("Choose a new password"),
  description: "Set a new password for your Ensemblis account.",
};

export default function ResetPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
