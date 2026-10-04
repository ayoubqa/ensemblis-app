import type { Metadata } from "next";
import { Suspense } from "react";
import { Explore, ExploreFallback } from "./_components/Explore";

export const metadata: Metadata = {
  title: "Explore agents",
  description: "See which AI agents are available on Ensemblis, what they do and how they perform.",
};

export default function AgentsPage() {
  return (
    <Suspense fallback={<ExploreFallback />}>
      <Explore />
    </Suspense>
  );
}
