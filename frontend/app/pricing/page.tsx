import type { Metadata } from "next";
import { PricingView } from "./_components/PricingView";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple, usage-based pricing. Pay for outcomes, not seats — every task is covered by the outcome guarantee.",
};

export default function PricingPage() {
  return <PricingView />;
}
