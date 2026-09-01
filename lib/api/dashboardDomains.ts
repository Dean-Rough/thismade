import "server-only";
import type { Id } from "@/convex/_generated/dataModel";

export type DomainStatus = "pending" | "verified" | "failed";

export type DnsRecord = { type: string; host: string; value: string };

export type Domain = {
  id: string;
  hostname: string;
  status: DomainStatus;
  records: DnsRecord[];
  createdAt: number;
};

// THI-92 tracks the Convex `domains` table + domainsActions (listByBusiness/
// addDomain/verifyDomain) this file should call — see THI-18's `spec`
// document for the exact contract. That table does not exist yet, so there
// is nothing to query: this returns an empty list rather than guessing at a
// shape, which the dashboard renders as the same "no domains yet" empty
// state a real zero-domains business would see. Swap the three functions
// below for real ConvexHttpClient calls (matching dashboardFiles.ts's
// shape) once THI-92 ships — no caller above this file should need to
// change.
export async function fetchDomains(_businessId: Id<"businesses">): Promise<Domain[]> {
  return [];
}

export async function addDomain(
  _businessId: Id<"businesses">,
  _hostname: string,
): Promise<{ records: DnsRecord[] }> {
  throw new Error("domains_backend_not_yet_available");
}

export async function verifyDomain(_businessId: Id<"businesses">, _domainId: string): Promise<Domain> {
  throw new Error("domains_backend_not_yet_available");
}
