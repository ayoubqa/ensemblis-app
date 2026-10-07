import type { Metadata } from "next";
import { EmptyState } from "@/components";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = { title: "Page not found" };

/** Themed 404 (Next's default one is hard-coded white and unreadable in dark mode). */
export default function NotFound() {
  return (
    <div className="narrow" style={{ padding: "56px 0" }}>
      <EmptyState icon="search" title="Page not found" action={{ label: "Go to the home page", href: ROUTES.home }}>
        This page doesn&apos;t exist or has moved.
      </EmptyState>
    </div>
  );
}
