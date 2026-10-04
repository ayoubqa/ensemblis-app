import type { Metadata } from "next";
import { PrivacyView } from "./PrivacyView";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What personal data the Ensemblis demo collects, why, who receives it, and your rights under the GDPR.",
};

export default function PrivacyPage() {
  return <PrivacyView />;
}
