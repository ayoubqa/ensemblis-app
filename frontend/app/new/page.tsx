import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/routes";

/** The old entry point now defines an outcome. */
export default function NewRedirect() {
  redirect(ROUTES.newObjective);
}
