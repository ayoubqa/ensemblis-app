import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Reset your password",
  description: "Get a link to choose a new password for your Ensemblis account.",
};

export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
