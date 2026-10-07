import type { Metadata } from "next";
import { Gallery } from "./Gallery";

export const metadata: Metadata = {
  title: "Example reports",
  description: "See what a team of AI agents delivers on Ensemblis: finished reports with numbered sources, from market research to competitor analysis.",
  openGraph: {
    title: "Example reports · Ensemblis",
    description: "Finished reports with numbered sources, produced by teams of AI agents.",
    type: "website",
  },
};

export default function ExamplesPage() {
  return <Gallery />;
}
