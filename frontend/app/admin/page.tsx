import type { Metadata } from "next";
import { privateMetadata } from "@/lib/site";
import { AdminGate } from "./_components/AdminGate";

export const metadata: Metadata = {
  ...privateMetadata("Operations console"),
  description: "Operations console for this Ensemblis deployment (operators only).",
};

export default function AdminPage() {
  return <AdminGate />;
}
