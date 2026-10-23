import { pageMetadata } from "@/lib/site";
import { PrivacyView } from "./PrivacyView";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description: "What personal data the Ensemblis demo collects, why, who receives it, and your rights under the GDPR.",
  path: "/privacy",
});

export default function PrivacyPage() {
  return <PrivacyView />;
}
