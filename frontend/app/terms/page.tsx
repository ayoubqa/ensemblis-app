import type { Metadata } from "next";
import { TermsView } from "./TermsView";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The rules for using the free Ensemblis public demo.",
};

export default function TermsPage() {
  return <TermsView />;
}
