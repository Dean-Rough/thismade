import { UserButton } from "@clerk/nextjs";
import { Bell } from "lucide-react";

import { ThemeToggle } from "@/components/theme/theme-toggle";

export function TopBar() {
  return (
    <header className="flex h-top-bar shrink-0 items-center justify-between border-b border-border bg-surface-raised px-4">
      <span className="text-sm font-medium">Your business</span>

      <div className="flex items-center gap-1">
        <ThemeToggle />

        {/* Placeholder — no confirmations data wired yet (out of scope for THI-15). */}
        <button
          type="button"
          aria-label="Confirmations"
          className="relative inline-flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <Bell className="size-4" />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-confirmation-pending" />
        </button>

        <UserButton />
      </div>
    </header>
  );
}
