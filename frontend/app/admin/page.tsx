import type { Metadata } from "next";
import { AdminGate } from "./_components/AdminGate";

export const metadata: Metadata = {
  title: "Operations console",
  description: "The Ensemblis owner dashboard for this deployment, or a demo of the marketplace operations console.",
  robots: { index: false },
};

export default function AdminPage() {
  return <AdminGate />;
}
