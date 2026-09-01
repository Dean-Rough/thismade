"use node";

import dns from "node:dns/promises";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

// Real DNS resolution requires the Node runtime (query/mutation run in the
// restricted V8 isolate and cannot do network I/O) — mirrors
// convex/workerRunner.ts's split: this file does only the network lookup,
// then hands the result to convex/domains.ts's recordVerificationResult
// mutation to persist.

type DnsRecord = { type: string; host: string; value: string };

function normalize(value: string): string {
  return value.replace(/\.$/, "").toLowerCase();
}

async function recordMatches(record: DnsRecord): Promise<boolean> {
  try {
    if (record.type === "TXT") {
      const chunks = await dns.resolveTxt(record.host);
      return chunks.map((c) => c.join("")).includes(record.value);
    }
    if (record.type === "CNAME") {
      const targets = await dns.resolveCname(record.host);
      return targets.map(normalize).includes(normalize(record.value));
    }
    // No other record type is computed by addDomain today, but resolve
    // generically rather than silently passing an unrecognized type. The
    // return shape varies by rrtype (dns.resolve's overloads can't be
    // statically resolved from a runtime string) — SOA-shaped or other
    // non-array results just fail to match rather than throwing.
    const results = await dns.resolve(record.host, record.type as never);
    if (!Array.isArray(results)) {
      return false;
    }
    return results.map((r) => normalize(String(r))).includes(normalize(record.value));
  } catch {
    // NXDOMAIN/ENODATA/timeout — the record isn't there (yet). A domain the
    // owner hasn't configured DNS for is an expected, common outcome here,
    // not an exceptional one, so this resolves to "not matched" rather than
    // propagating the error and failing the whole verification action.
    return false;
  }
}

// Platform-managed hostnames (empty `records`, see convex/domains.ts) have no
// owner-added record to check — Vercel provisions DNS automatically for the
// storefronts.rough.ink zone. "Verified" here just means the hostname
// actually resolves.
async function platformHostnameResolves(hostname: string): Promise<boolean> {
  try {
    await dns.resolve(hostname);
    return true;
  } catch {
    return false;
  }
}

export const verifyDomain = internalAction({
  args: { businessId: v.id("businesses"), domainId: v.id("domains") },
  handler: async (ctx, args): Promise<Doc<"domains">> => {
    const domain: Doc<"domains"> | null = await ctx.runQuery(internal.domains.getById, {
      businessId: args.businessId,
      domainId: args.domainId,
    });
    if (!domain) {
      throw new Error("not_found");
    }

    const verified =
      domain.records.length === 0
        ? await platformHostnameResolves(domain.hostname)
        : (await Promise.all(domain.records.map(recordMatches))).every(Boolean);

    return ctx.runMutation(internal.domains.recordVerificationResult, {
      businessId: args.businessId,
      domainId: args.domainId,
      status: verified ? "verified" : "failed",
    });
  },
});
