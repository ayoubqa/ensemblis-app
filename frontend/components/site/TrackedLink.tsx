"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { track, type AnalyticsEvent } from "@/lib/analytics";

/** A link that reports one analytics event when followed (a no-op unless analytics is enabled). */
export function TrackedLink({
  href,
  event,
  props,
  className,
  children,
}: {
  href: string;
  event: AnalyticsEvent;
  props: Record<string, string>;
  className?: string;
  children: ReactNode;
}) {
  const external = /^(https?:|mailto:)/i.test(href);
  const onClick = () => track(event, props);
  return external ? (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
