import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Log in", description: "Log in to your Ensemblis account." };

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
