import { redirect } from "next/navigation";

/** Earlier reports now live under Objectives → Earlier reports. */
export default function TasksRedirect() {
  redirect("/objectives?group=earlier");
}
