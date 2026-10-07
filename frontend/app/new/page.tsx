import { redirect } from "next/navigation";

/** The old "new task" entry point now defines an outcome. */
export default function NewRedirect() {
  redirect("/objectives/new");
}
