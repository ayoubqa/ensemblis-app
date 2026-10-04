import type { Metadata } from "next";
import { EconomicsView } from "./_components/EconomicsView";

export const metadata: Metadata = {
  title: "Agent economics",
  description: "How a single task pays out: model your agent's price, platform fee and monthly volume.",
};

export default function EconomicsPage() {
  return <EconomicsView />;
}
