import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";

/** Workflows became recurring objectives (server redirect: no blank page, works without JavaScript). */
export default function WorkflowsRedirect() {
  redirect(ROUTES.routines);
}
