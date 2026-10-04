import type { Metadata } from "next";
import { ChangelogView } from "./_components/ChangelogView";

export const metadata: Metadata = {
  title: "Changelog",
  description: "A running log of Ensemblis product updates.",
};

export default function ChangelogPage() {
  return <ChangelogView />;
}
