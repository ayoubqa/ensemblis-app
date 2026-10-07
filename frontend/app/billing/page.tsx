"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/routes";

/** Billing moved to Usage. Kept so old links and in-flight Stripe returns (?checkout=…) still land. */
export default function BillingRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`${ROUTES.usage}${window.location.search}`);
  }, [router]);
  return null;
}
