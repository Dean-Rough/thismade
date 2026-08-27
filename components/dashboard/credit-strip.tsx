/**
 * Placeholder only — no usage/Autopilot data wired yet (out of scope for
 * THI-15, see THI-14 Part 4.1). Always visible per THI-14 Principle 3
 * ("never hide the safety rails").
 */
export function CreditStrip() {
  return (
    <div className="flex h-credit-strip shrink-0 items-center justify-between border-t border-border bg-surface-raised px-4 text-xs">
      <div className="flex items-center gap-2 text-ink-muted">
        <span className="inline-flex size-1.5 rounded-full bg-ink-muted" />
        Autopilot — off
      </div>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-border">
          <div className="h-full w-0 rounded-full bg-credit-ok" />
        </div>
        <span className="font-mono text-ink-muted">— / — credits</span>
      </div>
    </div>
  );
}
