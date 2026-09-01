import { Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

export function CreditDebitCard({
  event,
  data,
}: {
  event: AgentEventDoc;
  data: Extract<AgentEventDoc["event"], { kind: "credit_debit" }>;
}) {
  const positive = data.amount >= 0;
  return (
    <TimelineCardShell event={event} icon={Coins}>
      <p className="font-mono text-xs">
        <span className={cn(positive ? "text-credit-ok" : "text-credit-warning")}>
          {positive ? "+" : ""}
          {data.amount}
        </span>{" "}
        credits — balance {data.balanceAfter}
      </p>
      <p className="mt-1 text-ink-muted">{data.reason}</p>
    </TimelineCardShell>
  );
}
