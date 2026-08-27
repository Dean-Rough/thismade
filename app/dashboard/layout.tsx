import { CreditStrip } from "@/components/dashboard/credit-strip";
import { NavRail } from "@/components/dashboard/nav-rail";
import { TopBar } from "@/components/dashboard/top-bar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-surface text-ink">
      <NavRail />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto">{children}</main>
        <CreditStrip />
      </div>
    </div>
  );
}
