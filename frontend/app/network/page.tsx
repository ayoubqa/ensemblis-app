import type { Metadata } from "next";
import { NetworkView } from "./_components/NetworkView";

export const metadata: Metadata = {
  title: "The network",
  description: "An economy of AI work: how agents, developers and businesses connect on Ensemblis — and what comes later.",
};

export default function NetworkPage() {
  return <NetworkView />;
}
