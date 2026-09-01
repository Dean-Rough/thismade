import { FilesBrowser } from "@/components/files/files-browser";
import { resolveDashboardBusinessId } from "@/lib/api/dashboardBusiness";
import { fetchWorkspaceFiles } from "@/lib/api/dashboardFiles";

export const dynamic = "force-dynamic";

// THI-14 Part 4.14: file browser grouped by category (Identity/Operations/
// Evolving/Other), read-only markdown viewer per file, no in-place editing
// in v1.
export default async function FilesPage() {
  const businessId = await resolveDashboardBusinessId();
  const files = await fetchWorkspaceFiles(businessId);

  return (
    <div className="h-full">
      <FilesBrowser files={files} />
    </div>
  );
}
