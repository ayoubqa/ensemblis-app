"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** <main id="main" class="fade-in"> re-keyed per route so every page fades in (prototype render()). */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <main id="main" key={pathname} className="fade-in" tabIndex={-1} style={{ outline: "none" }}>
      {children}
    </main>
  );
}

export default PageTransition;
