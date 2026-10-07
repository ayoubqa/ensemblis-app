"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/routes";

/** Workflows became recurring objectives. */
export default function WorkflowsRedirect() {
  const router = useRouter();
  useEffect(() => router.replace(ROUTES.routines), [router]);
  return null;
}
