import { DomainsScreen } from "@/components/domains/domains-screen";
import { resolveDashboardBusinessId } from "@/lib/api/dashboardBusiness";
import { fetchDomains } from "@/lib/api/dashboardDomains";

export const dynamic = "force-dynamic";

// THI-14 Part 4.9: list connected domains with DNS-record status, an
// add-domain flow that shows the exact records to add, and a verify action.
export default async function DomainsPage() {
  const businessId = await resolveDashboardBusinessId();
  const domains = await fetchDomains(businessId);

  return (
    <div className="h-full overflow-y-auto p-6">
      <DomainsScreen domains={domains} />
    </div>
  );
}
