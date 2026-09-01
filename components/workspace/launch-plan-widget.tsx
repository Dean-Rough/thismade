import { CheckCircle2, Circle } from "lucide-react";
import type { LaunchPlanState } from "@/lib/launch-plan";
import { cn } from "@/lib/utils";

export function LaunchPlanWidget({ plan }: { plan: LaunchPlanState }) {
  const doneCount = plan.steps.filter((s) => s.done).length;
  const progressPct = Math.round((doneCount / plan.steps.length) * 100);

  return (
    <div className="border-t border-border p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
        Launch week — day {plan.dayNumber} of 7
      </p>
      {plan.complete ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-credit-ok" style={{ width: "100%" }} />
        </div>
      ) : (
        <ul className="space-y-1.5">
          {plan.steps.map((step) => (
            <li key={step.key} className="flex items-center gap-2 text-xs">
              {step.done ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-credit-ok" />
              ) : (
                <Circle className="size-3.5 shrink-0 text-ink-muted" />
              )}
              <span className={cn(step.done ? "text-ink-muted line-through" : "text-ink")}>
                {step.label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!plan.complete && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-accent" style={{ width: `${progressPct}%` }} />
        </div>
      )}
    </div>
  );
}
