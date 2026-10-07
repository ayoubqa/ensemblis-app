import type { Metadata } from "next";
import { AdminGate } from "./_components/AdminGate";

export const metadata: Metadata = {
  title: "Operations console",
  description: "Operations console for this Ensemblis deployment (operators only).",
  robots: { index: false },
};

export default function AdminPage() {
  return <AdminGate />;
}
