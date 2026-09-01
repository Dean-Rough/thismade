"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { PendingApprovalContent } from "@/components/approvals/pending-approval-content";
import type { AgentTaskDoc } from "@/lib/api/dashboardTimeline";

export function ConfirmationsQueue({ tasks }: { tasks: AgentTaskDoc[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pending = tasks.filter((t) => t.pendingApproval);

  if (pending.length === 0) {
    return (
      <p className="p-6 text-sm text-ink-muted">Nothing waiting on a decision right now.</p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {pending.map((task) => {
        const expanded = expandedId === task._id;
        const approval = task.pendingApproval;
        if (!approval) return null;
        return (
          <li key={task._id} className="p-3">
            <button
              type="button"
              className="flex w-full items-center gap-3 text-left"
              onClick={() => setExpandedId(expanded ? null : task._id)}
            >
              {expanded ? (
                <ChevronDown className="size-4 shrink-0 text-ink-muted" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-ink-muted" />
              )}
              <ShieldAlert className="size-4 shrink-0 text-confirmation-pending" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
              <span className="font-mono text-xs text-ink-muted">{approval.toolName}</span>
            </button>
            {expanded && (
              <div className="ml-10 mt-2 rounded-card border border-confirmation-pending/40 bg-surface-raised p-3 text-sm">
                <PendingApprovalContent
                  taskId={task._id}
                  toolName={approval.toolName}
                  argsSummary={approval.argsSummary}
                  argsHash={approval.argsHash}
                  isStillPending
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
