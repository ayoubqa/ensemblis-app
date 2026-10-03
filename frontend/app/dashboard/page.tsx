"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const statusColor: Record<string, string> = {
  COMPLETED: "text-green-400",
  RUNNING: "text-accent",
  PLANNING: "text-gray-400",
  FAILED: "text-red-400",
  REFUNDED: "text-gray-500",
};

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<any[] | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (user) api.listTasks().then((r) => setTasks(r.tasks));
  }, [user]);

  if (loading || !user) return null;

  return (
    <section className="max-w-4xl mx-auto px-6 py-14">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-semibold">Good to see you, {user.name.split(" ")[0]}.</h1>
        <Link href="/new" className="btn btn-primary">
          + New task
        </Link>
      </div>

      {!tasks && <p className="text-gray-400">Loading…</p>}
      {tasks?.length === 0 && (
        <p className="text-gray-400">Nothing here yet — start your first task to see it appear.</p>
      )}
      <div className="space-y-3">
        {tasks?.map((t) => (
          <Link href={`/tasks/${t.id}`} key={t.id} className="card flex justify-between items-center block">
            <div>
              <div className="font-medium">{t.title}</div>
              <div className="text-xs text-gray-500">{new Date(t.createdAt).toLocaleString()}</div>
            </div>
            <span className={`text-sm ${statusColor[t.status] || ""}`}>{t.status}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
