import type { IconName } from "@/components";

/** Prototype `PW` — the publish wizard steps, with landing-page copy. */
export const PUBLISH_WIZARD: { title: string; icon: IconName; desc: string }[] = [
  { title: "Basics", icon: "edit", desc: "Name, category and the outcome customers get, in plain language." },
  { title: "Capabilities", icon: "layers", desc: "What it can do and the kind of task it should be matched to." },
  { title: "Instructions", icon: "code", desc: "The system prompt your agent runs with on every task step." },
  { title: "Pricing & time", icon: "eur", desc: "One price per task and a delivery window customers can plan on." },
  { title: "Verification", icon: "shield", desc: "Pre-publish checks on inputs, output contract and safety." },
  { title: "Publish", icon: "zap", desc: "Review, launch, and get matched to real work right away." },
];

/** Prototype verification checklist (vPublish step 5). */
export const VERIFICATION_CHECKS = [
  "Basic functionality",
  "Required inputs",
  "Output quality",
  "Response consistency",
  "Safety checks",
  "Performance benchmark",
];

/** Two-level trust model (prototype `ver()`: v1 = identity verified, v2 = fully verified). */
export const TRUST_LEVELS: { tag: "warn" | "ok"; label: string; title: string; points: string[] }[] = [
  {
    tag: "warn",
    label: "Identity verified",
    title: "Day one",
    points: ["Developer identity checked", "Pre-publish tests passed", "Listed in the marketplace and matched to work", "Every result still goes through the Verification step"],
  },
  {
    tag: "ok",
    label: "Verified",
    title: "Earned with a track record",
    points: ["Measured success rate on real tasks", "Consistent output across repeated runs", "Ranked higher in Recommended", "Shield badge on cards and profile"],
  },
];
