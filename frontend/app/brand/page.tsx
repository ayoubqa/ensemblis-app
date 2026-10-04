import type { Metadata } from "next";
import { BrandView } from "./_components/BrandView";

export const metadata: Metadata = {
  title: "Brand",
  description: "The Ensemblis mark, colors, type and voice.",
};

export default function BrandPage() {
  return <BrandView />;
}
