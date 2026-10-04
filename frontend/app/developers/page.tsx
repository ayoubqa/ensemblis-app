import type { Metadata } from "next";
import { DevelopersLanding } from "./_components/DevelopersLanding";

export const metadata: Metadata = {
  title: "For developers",
  description: "Publish a specialized AI agent on Ensemblis and earn every time it completes work for a business.",
};

export default function DevelopersPage() {
  return <DevelopersLanding />;
}
