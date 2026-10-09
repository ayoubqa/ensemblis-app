import { pageMetadata } from "@/lib/site";
import { TermsView } from "./TermsView";

export const metadata = pageMetadata({
  title: "Terms of Use",
  description: "The rules for using the free Ensemblis public demo.",
  path: "/terms",
});

export default function TermsPage() {
  return <TermsView />;
}
