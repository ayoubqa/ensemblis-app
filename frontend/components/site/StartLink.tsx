"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { track } from "@/lib/analytics";
import { ROUTES } from "@/lib/routes";

/**
 * The one "get started" destination, decided at runtime so no visitor hits a dead end:
 *   signed in                → define an outcome
 *   sign-up needs an invite  → /access (request access, or enter an invite)
 *   open sign-up             → /signup
 * The label stays the same in every case, so nothing shifts when the session or config arrives.
 */
export function useStartHref(): string {
  const { user } = useAuth();
  const { config } = useConfig();
  if (user) return ROUTES.newObjective;
  return config.inviteRequired ? ROUTES.access : ROUTES.signup;
}

export function StartLink({ children, className = "btn p lg", from }: { children: ReactNode; className?: string; from: string }) {
  const href = useStartHref();
  return (
    <Link href={href} className={className} onClick={() => track("cta_click", { from, to: href })}>
      {children}
    </Link>
  );
}
