"use client";

import { useState } from "react";

import { CreditStrip } from "@/components/dashboard/credit-strip";
import { MobileNavDrawer } from "@/components/dashboard/mobile-nav-drawer";
import { NavRail } from "@/components/dashboard/nav-rail";
import { TopBar } from "@/components/dashboard/top-bar";

/** Holds the mobile nav open/close state shared between `TopBar`'s trigger and `MobileNavDrawer` (THI-93). */
export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isNavOpen, setIsNavOpen] = useState(false);

  return (
    <div className="flex h-screen bg-surface text-ink">
      <NavRail />
      <MobileNavDrawer open={isNavOpen} onOpenChange={setIsNavOpen} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar onOpenNav={() => setIsNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <CreditStrip />
      </div>
    </div>
  );
}
