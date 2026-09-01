"use client";

import { useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
import { markTaskDoneAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentTaskDoc } from "@/lib/api/dashboardTimeline";

const COLUMNS: { status: AgentTaskDoc["status"]; label: string }[] = [
  { status: "todo", label: "To do" },
  { status: "in_progress", label: "In progress" },
  { status: "needs_review", label: "Needs review" },
  { status: "done", label: "Done" },
];

function TaskCard({ task, onChanged }: { task: AgentTaskDoc; onChanged?: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleMarkDone() {
    setError(null);
    startTransition(async () => {
      try {
        await markTaskDoneAction(task._id);
        onChanged?.();
      } catch {
        setError("Could not mark this task done — try again.");
      }
    });
  }

  return (
    <div className="space-y-1.5 rounded-card border border-border bg-surface p-2.5 text-sm">
      <p className="font-medium leading-snug">{task.title}</p>
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <span className="rounded bg-surface-raised px-1.5 py-0.5">{task.workerType}</span>
        <span>{task.creditCost} credits</span>
      </div>
      {task.circuitBroken && (
        <p className="text-xs font-medium text-confirmation-rejected">Circuit broken — needs attention</p>
      )}
      {task.pendingApproval && (
        <p className="text-xs font-medium text-confirmation-pending">Awaiting approval</p>
      )}
      {task.status === "needs_review" && !task.circuitBroken && (
        <>
          <Button size="sm" variant="secondary" disabled={isPending} onClick={handleMarkDone}>
            Mark done
          </Button>
          {error && <p className="text-xs text-confirmation-rejected">{error}</p>}
        </>
      )}
    </div>
  );
}

export function TaskBoard({ tasks, onChanged }: { tasks: AgentTaskDoc[]; onChanged?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface-raised">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex h-top-bar shrink-0 items-center justify-between border-b border-border px-3 text-sm font-medium"
      >
        {!collapsed && "Task board"}
        <ChevronRight className={cn("size-4 transition-transform", !collapsed && "rotate-180")} />
      </button>
      {!collapsed && (
        <div className="flex-1 space-y-4 overflow-y-auto p-3">
          {COLUMNS.map((column) => {
            const columnTasks = tasks.filter((t) => t.status === column.status);
            return (
              <div key={column.status} className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {column.label} ({columnTasks.length})
                </p>
                <div className="space-y-2">
                  {columnTasks.map((task) => (
                    <TaskCard key={task._id} task={task} onChanged={onChanged} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
