import "server-only";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { getDashboardConvexClient } from "./dashboardConvex";
import { getConvexServiceSecret } from "./serviceSecret";

export type DomainStatus = "pending" | "verified" | "failed";

export type DnsRecord = { type: string; host: string; value: string };

export type Domain = {
  id: string;
  hostname: string;
  status: DomainStatus;
  records: DnsRecord[];
  createdAt: number;
};

function toDomain(doc: Doc<"domains">): Domain {
  return {
    id: doc._id,
    hostname: doc.hostname,
    status: doc.status,
    records: doc.records,
    createdAt: doc.createdAt,
  };
}

export async function fetchDomains(businessId: Id<"businesses">): Promise<Domain[]> {
  const client = getDashboardConvexClient();
  const secret = getConvexServiceSecret();
  const domains = await client.action(api.domainsActions.listByBusiness, { businessId, secret });
  return domains.map(toDomain);
}

export async function addDomain(
  businessId: Id<"businesses">,
  hostname: string,
): Promise<{ records: DnsRecord[] }> {
  const client = getDashboardConvexClient();
  const secret = getConvexServiceSecret();
  const domain = await client.action(api.domainsActions.addDomain, { businessId, hostname, secret });
  return { records: domain.records };
}

export async function verifyDomain(businessId: Id<"businesses">, domainId: string): Promise<Domain> {
  const client = getDashboardConvexClient();
  const secret = getConvexServiceSecret();
  const domain = await client.action(api.domainsActions.verifyDomain, {
    businessId,
    domainId: domainId as Id<"domains">,
    secret,
  });
  return toDomain(domain);
}
