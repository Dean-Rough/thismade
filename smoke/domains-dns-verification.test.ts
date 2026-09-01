/**
 * Live DNS smoke test for THI-92 (Convex `domains` table + verification
 * actions, split out of THI-18's Domains UI).
 *
 * Unlike every hermetic `convex/*.test.ts`, this file makes a REAL network
 * call: `domainsVerify.verifyDomain` performs an actual `node:dns` lookup
 * against public DNS, not a stub. Per this repo's own convention (see the
 * `smoke/**` exclusion + comment in vitest.config.ts: "makes real network
 * calls"), that puts it here rather than in the default `npm test` suite —
 * run it with `npm run test:e2e`.
 *
 * It runs the full secret-gated action layer (`domainsActions.*`), the same
 * one the dashboard's `lib/api/dashboardDomains.ts` calls in production, via
 * `convex-test`'s local simulated backend rather than `ConvexHttpClient`
 * against a live cloud deployment — unlike commerce-e2e.test.ts, which has a
 * real `CONVEX_DEPLOY_KEY`. This environment has no live Convex deployment
 * credentials (a named, open gap — see the prior Stripe/Convex credential
 * blocker in DECISIONS.md for the same class of issue). convex-test still
 * runs the real schema, the real service-secret check, and real internal
 * mutations/queries; only the transport to a hosted Convex deployment is
 * swapped for an in-process one. The one piece that must be real either way —
 * the DNS lookup — is not mocked here. Once a deploy key is available, this
 * should additionally (or instead) run against a live deployment the same
 * way commerce-e2e.test.ts does, rather than silently staying convex-test-only
 * forever.
 *
 * The "verified" case piggybacks on `acme-test.storefronts.rough.ink`
 * (DECISIONS.md §THI-57), a real, already-deployed storefront subdomain —
 * confirmed resolving via `dig` immediately before this file was written —
 * rather than fabricating DNS records this environment has no way to
 * provision. The "failed" case uses a BYOD hostname under example.com
 * (IANA-reserved, RFC 2606) that will never have the generated TXT/CNAME
 * challenge, proving the lookup can genuinely fail, not just always pass.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import schema from "@/convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

const CONVEX_SERVICE_SECRET = "smoke-test-service-secret";
process.env.CONVEX_SERVICE_SECRET = CONVEX_SERVICE_SECRET;

async function seedBusiness(t: ReturnType<typeof convexTest>, slug: string) {
  const businessId = await t.action(api.businessesActions.create, {
    name: `Domains smoke ${slug}`,
    slug,
    ownerUserId: "user_smoke",
    secret: CONVEX_SERVICE_SECRET,
  });
  return businessId;
}

describe("domainsActions end-to-end (real DNS, secret-gated)", () => {
  it("rejects every action when the service secret is wrong", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, `domains-smoke-auth-${Math.random().toString(36).slice(2)}`);

    await expect(
      t.action(api.domainsActions.listByBusiness, { businessId, secret: "wrong" }),
    ).rejects.toThrow();
    await expect(
      t.action(api.domainsActions.addDomain, { businessId, hostname: "x.example.com", secret: "wrong" }),
    ).rejects.toThrow();
  });

  it("verifies a real platform-managed subdomain that is actually live", async () => {
    const t = convexTest(schema, modules);
    // Matches the real, already-deployed acme-test business (DECISIONS.md
    // §THI-57) so the platform-managed hostname below is one that genuinely
    // resolves — this business row is otherwise unrelated to that real one.
    const businessId = await seedBusiness(t, "acme-test");

    const added = await t.action(api.domainsActions.addDomain, {
      businessId,
      hostname: "acme-test.storefronts.rough.ink",
      secret: CONVEX_SERVICE_SECRET,
    });
    expect(added.records).toEqual([]);
    expect(added.status).toBe("pending");

    const verified = await t.action(api.domainsActions.verifyDomain, {
      businessId,
      domainId: added._id,
      secret: CONVEX_SERVICE_SECRET,
    });

    expect(verified.status).toBe("verified");
    expect(verified.lastCheckedAt).toEqual(expect.any(Number));

    const listed = await t.action(api.domainsActions.listByBusiness, {
      businessId,
      secret: CONVEX_SERVICE_SECRET,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0].status).toBe("verified");
  }, 20_000);

  it("fails verification for a bring-your-own-domain hostname with no matching DNS records", async () => {
    const t = convexTest(schema, modules);
    const businessId = await seedBusiness(t, `domains-smoke-byod-${Math.random().toString(36).slice(2)}`);

    const added = await t.action(api.domainsActions.addDomain, {
      businessId,
      hostname: "thismade-smoke-test-unclaimed.example.com",
      secret: CONVEX_SERVICE_SECRET,
    });
    expect(added.records).toHaveLength(2);
    expect(added.records[0].type).toBe("CNAME");
    expect(added.records[1].type).toBe("TXT");

    const verified = await t.action(api.domainsActions.verifyDomain, {
      businessId,
      domainId: added._id,
      secret: CONVEX_SERVICE_SECRET,
    });

    expect(verified.status).toBe("failed");
    expect(verified.lastCheckedAt).toEqual(expect.any(Number));
  }, 20_000);
});
