import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentEventDoc } from "./timeline-event-kind";

const ACTOR_LABEL: Record<AgentEventDoc["actor"], string> = {
  owner: "Owner",
  ceo: "CEO",
  worker: "Worker",
  system: "System",
};

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function TimelineCardShell({
  event,
  icon: Icon,
  tone = "default",
  children,
}: {
  event: AgentEventDoc;
  icon: LucideIcon;
  tone?: "default" | "warning" | "danger" | "success";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-card border border-border bg-surface-raised p-3 text-sm",
        tone === "warning" && "border-confirmation-pending/40",
        tone === "danger" && "border-confirmation-rejected/40",
        tone === "success" && "border-confirmation-approved/40",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0 text-ink-muted",
          tone === "warning" && "text-confirmation-pending",
          tone === "danger" && "text-confirmation-rejected",
          tone === "success" && "text-confirmation-approved",
        )}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span className="font-medium">{ACTOR_LABEL[event.actor]}</span>
          <span className="font-mono">{formatTime(event.createdAt)}</span>
        </div>
        <div className="text-ink">{children}</div>
      </div>
    </div>
  );
}
