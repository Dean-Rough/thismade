"use client";

import { useEffect } from "react";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";

import { NavLinks } from "@/components/dashboard/nav-rail";

interface MobileNavDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Off-canvas nav for below `md` (THI-93) — the desktop `NavRail` stays a static column at `md`+. */
export function MobileNavDrawer({ open, onOpenChange }: MobileNavDrawerProps) {
  // `md:hidden` only visually hides Overlay/Content past Tailwind's `md` breakpoint
  // (768px, unmodified in tailwind.config.ts) — Dialog.Root itself stays logically
  // open across a resize (e.g. tablet rotation), which would otherwise leave body
  // scroll locked and the focus trap wired to now-invisible content.
  useEffect(() => {
    if (!open) return;
    const query = window.matchMedia("(min-width: 768px)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) onOpenChange(false);
    };
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, [open, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 md:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 flex h-full w-nav-rail flex-col border-r border-border bg-surface-raised outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left duration-200 md:hidden"
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <div className="flex h-top-bar items-center justify-between border-b border-border px-4">
            <span className="truncate text-sm font-medium">Your business</span>
            <Dialog.Close
              aria-label="Close menu"
              className="inline-flex size-9 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <NavLinks onNavigate={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
