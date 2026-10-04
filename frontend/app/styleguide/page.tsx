import type { Metadata } from "next";
import { Styleguide } from "./Styleguide";

export const metadata: Metadata = {
  title: "Style guide",
  description: "Living style guide for the Ensemblis frontend: every shared component and core CSS class.",
  robots: { index: false },
};

export default function StyleguidePage() {
  return <Styleguide />;
}
