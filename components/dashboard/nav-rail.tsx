"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckCircle2,
  FolderOpen,
  Globe,
  Inbox,
  Megaphone,
  MessageSquare,
  Package,
  Settings,
  ShoppingCart,
  Sparkles,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Workspace", icon: MessageSquare },
  { href: "/dashboard/products", label: "Products", icon: Package },
  { href: "/dashboard/orders", label: "Orders", icon: ShoppingCart },
  { href: "/dashboard/leads", label: "Leads", icon: Users },
  { href: "/dashboard/marketing", label: "Marketing", icon: Megaphone },
  { href: "/dashboard/inbox", label: "Inbox", icon: Inbox },
  { href: "/dashboard/domains", label: "Domains", icon: Globe },
  { href: "/dashboard/studio", label: "Studio", icon: Sparkles },
  { href: "/dashboard/files", label: "Files", icon: FolderOpen },
  { href: "/dashboard/confirmations", label: "Confirmations", icon: CheckCircle2 },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

export function NavRail() {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-nav-rail flex-col border-r border-border bg-surface-raised">
      {/* Single implicit business context for Phase 1 — the multi-business switcher (/dashboard/businesses) is deferred past this gate per DECISIONS.md. */}
      <div className="flex h-top-bar items-center border-b border-border px-4">
        <span className="truncate text-sm font-medium">Your business</span>
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface hover:text-ink",
                  active && "bg-surface font-medium text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
