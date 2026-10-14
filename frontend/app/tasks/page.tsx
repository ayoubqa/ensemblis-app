import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";

/** Earlier reports now live in Reports → Earlier reports (also under Objectives → Earlier reports). */
export default function TasksRedirect() {
  redirect(ROUTES.legacyReports);
}
