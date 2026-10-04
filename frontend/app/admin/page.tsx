import type { Metadata } from "next";
import { AdminView } from "./_components/AdminView";

export const metadata: Metadata = {
  title: "Operations console",
  description: "A demo of the Ensemblis marketplace operations console.",
  robots: { index: false },
};

export default function AdminPage() {
  return <AdminView />;
}
