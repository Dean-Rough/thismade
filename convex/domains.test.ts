import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedTwoBusinesses(t: ReturnType<typeof convexTest>) {
  const businessAId = await t.mutation(internal.businesses.create, {
    name: "Business A",
    slug: `domains-a-${Math.random().toString(36).slice(2)}`,
    ownerUserId: "user_a",
  });
  const businessBId = await t.mutation(internal.businesses.create, {
    name: "Business B",
    slug: `domains-b-${Math.random().toString(36).slice(2)}`,
    ownerUserId: "user_b",
  });
  return { businessAId, businessBId };
}

describe("domains.addDomain", () => {
  it("computes no records for the platform-managed {slug}.storefronts.rough.ink hostname", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);
    const fetched = await t.query(internal.businesses.getSelf, { businessId: businessAId });
    const hostname = `${fetched!.slug}.storefronts.rough.ink`;

    const domain = await t.mutation(internal.domains.addDomain, {
      businessId: businessAId,
      hostname,
    });

    expect(domain.hostname).toBe(hostname);
    expect(domain.status).toBe("pending");
    expect(domain.records).toEqual([]);
    expect(domain.lastCheckedAt).toBeNull();
  });

  it("computes a CNAME + TXT challenge for a bring-your-own-domain hostname", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);
    const fetched = await t.query(internal.businesses.getSelf, { businessId: businessAId });

    const domain = await t.mutation(internal.domains.addDomain, {
      businessId: businessAId,
      hostname: "shop.example.com",
    });

    expect(domain.records).toEqual([
      { type: "CNAME", host: "shop.example.com", value: `${fetched!.slug}.storefronts.rough.ink` },
      {
        type: "TXT",
        host: "_thismade-verify.shop.example.com",
        value: expect.stringMatching(/^thismade-domain-verification=/),
      },
    ]);
  });

  it("lowercases and trims the hostname", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    const domain = await t.mutation(internal.domains.addDomain, {
      businessId: businessAId,
      hostname: "  Shop.Example.COM  ",
    });

    expect(domain.hostname).toBe("shop.example.com");
  });

  it.each([
    ["empty string", ""],
    ["single label with no dot", "localhost"],
    ["a label starting with a hyphen", "-bad.example.com"],
    ["a label with an invalid character", "sh op.example.com"],
  ])("rejects an invalid hostname: %s", async (_label, hostname) => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    await expect(
      t.mutation(internal.domains.addDomain, { businessId: businessAId, hostname }),
    ).rejects.toThrow("invalid_hostname");
  });

  it("rejects a hostname already registered to any business", async () => {
    const t = convexTest(schema, modules);
    const { businessAId, businessBId } = await seedTwoBusinesses(t);

    await t.mutation(internal.domains.addDomain, {
      businessId: businessAId,
      hostname: "shared.example.com",
    });

    await expect(
      t.mutation(internal.domains.addDomain, {
        businessId: businessBId,
        hostname: "shared.example.com",
      }),
    ).rejects.toThrow("hostname_taken");
  });
});

describe("domains.listByBusiness: tenancy", () => {
  it("only returns the requesting business's domains", async () => {
    const t = convexTest(schema, modules);
    const { businessAId, businessBId } = await seedTwoBusinesses(t);
    await t.mutation(internal.domains.addDomain, { businessId: businessAId, hostname: "a.example.com" });
    await t.mutation(internal.domains.addDomain, { businessId: businessBId, hostname: "b.example.com" });

    const domainsForA = await t.query(internal.domains.listByBusiness, { businessId: businessAId });

    expect(domainsForA).toHaveLength(1);
    expect(domainsForA[0].hostname).toBe("a.example.com");
  });
});

describe("domains.getById: tenancy", () => {
  it("resolves to null for a domain owned by a different business", async () => {
    const t = convexTest(schema, modules);
    const { businessAId, businessBId } = await seedTwoBusinesses(t);
    const domain = await t.mutation(internal.domains.addDomain, {
      businessId: businessAId,
      hostname: "a.example.com",
    });

    const scopedToB = await t.query(internal.domains.getById, {
      businessId: businessBId,
      domainId: domain._id,
    });

    expect(scopedToB).toBeNull();
  });
});

describe("domains.recordVerificationResult", () => {
  it("updates status and stamps lastCheckedAt", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);
    const domain = await t.mutation(internal.domains.addDomain, {
      businessId: businessAId,
      hostname: "a.example.com",
    });
    expect(domain.lastCheckedAt).toBeNull();

    const updated = await t.mutation(internal.domains.recordVerificationResult, {
      businessId: businessAId,
      domainId: domain._id,
      status: "verified",
    });

    expect(updated.status).toBe("verified");
    expect(updated.lastCheckedAt).toEqual(expect.any(Number));
  });

  it("rejects a cross-tenant domainId rather than leaking its existence", async () => {
    const t = convexTest(schema, modules);
    const { businessAId, businessBId } = await seedTwoBusinesses(t);
    const domain = await t.mutation(internal.domains.addDomain, {
      businessId: businessAId,
      hostname: "a.example.com",
    });

    await expect(
      t.mutation(internal.domains.recordVerificationResult, {
        businessId: businessBId,
        domainId: domain._id,
        status: "verified",
      }),
    ).rejects.toThrow("not_found");
  });
});
