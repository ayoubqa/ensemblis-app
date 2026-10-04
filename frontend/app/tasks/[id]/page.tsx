"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError, type Task, type TaskStatus } from "@/lib/api";
import { EmptyState, Icon, PageSkeleton, RequireAuth, useToast } from "@/components";
import { useAuth } from "@/lib/auth-context";
import { confetti } from "@/lib/confetti";
import { usePolling } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { RunView } from "./_components/RunView";
import { ResultView } from "./_components/ResultView";
import { FailedView } from "./_components/FailedView";
import { isLive } from "./_components/shared";

export default function TaskPage() {
  return (
    <RequireAuth>
      <TaskLive />
    </RequireAuth>
  );
}

/** One live page per task: run view → result view (or failed view), driven by polling. */
function TaskLive() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { refresh } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const prevStatus = useRef<TaskStatus | null>(null);
  const celebrated = useRef(false);

  const accept = useCallback(
    (t: Task) => {
      const prev = prevStatus.current;
      const wasLive = prev === "RUNNING" || prev === "PLANNING";
      if (wasLive && t.status === "COMPLETED" && !celebrated.current) {
        celebrated.current = true;
        confetti();
        toast("Your work is ready");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      if (wasLive && (t.status === "FAILED" || t.status === "REFUNDED")) {
        toast.error("A step failed. You've been refunded automatically.");
        refresh(); // pick up the refunded balance in the header
      }
      prevStatus.current = t.status;
      setTask(t);
    },
    [toast, refresh]
  );

  const live = !task || isLive(task);
  usePolling(
    async () => {
      try {
        const { task: t } = await api.getTask(id);
        setError(null);
        accept(t);
        return isLive(t);
      } catch (e) {
        const ae = e instanceof ApiError ? e : new ApiError("Something went wrong", 500);
        setError(ae);
        return !(ae.status === 404 || ae.status === 403 || ae.status === 400);
      }
    },
    2000,
    { enabled: live && !(error && (error.status === 404 || error.status === 403 || error.status === 400)) }
  );

  // Tab title shows live progress, e.g. "(2/4) Market sizing · Ensemblis".
  useEffect(() => {
    if (!task) return;
    const done = task.steps.filter((s) => s.status === "COMPLETED").length;
    const prefix = isLive(task) ? `(${done}/${task.steps.length}) ` : task.status === "COMPLETED" ? "✓ " : "";
    const before = document.title;
    document.title = `${prefix}${task.title} · Ensemblis`;
    return () => {
      document.title = before;
    };
  }, [task]);

  if (!task) {
    if (error && (error.status === 404 || error.status === 403 || error.status === 400)) {
      return (
        <div className="narrow" style={{ padding: "56px 0" }}>
          <EmptyState icon="list" title="Task not found" action={{ label: "Go to My work", href: ROUTES.tasks }}>
            This task doesn&apos;t exist or belongs to another account.
          </EmptyState>
        </div>
      );
    }
    return (
      <>
        {error && (
          <div className="wrap" style={{ paddingTop: 20 }}>
            <div className="notice" role="alert">
              <Icon name="alert" />
              <span>{error.message} Retrying automatically…</span>
            </div>
          </div>
        )}
        <PageSkeleton />
      </>
    );
  }

  if (task.status === "COMPLETED") return <ResultView task={task} onTask={accept} />;
  if (task.status === "FAILED" || task.status === "REFUNDED") return <FailedView task={task} onTask={accept} />;
  return <RunView task={task} stale={!!error} />;
}
