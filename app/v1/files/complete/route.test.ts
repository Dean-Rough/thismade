import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";

// Fake Convex backend. `files:completeUpload` reproduces the real tenancy
// contract (convex/lib/tenancy.ts / convex/files.ts): a fileId that doesn't
// belong to the caller's businessId resolves to null, exactly like an id that
// doesn't exist at all — the REST route turns that into a 404, never a 403.
const backend = vi.hoisted(() => {
  const apiKeys = new Map<string, any>();
  const files = new Map<string, any>();
  const idempotency = new Map<string, any>();
  let counter = 0;

  function nextId(prefix: string) {
    counter += 1;
    return `${prefix}_${counter}`;
  }

  function reset() {
    apiKeys.clear();
    files.clear();
    idempotency.clear();
    counter = 0;
  }

  function seedApiKey(input: { businessId: string; hashedKey: string; scopes: string[] }) {
    const id = nextId("apiKey");
    apiKeys.set(id, {
      _id: id,
      businessId: input.businessId,
      hashedKey: input.hashedKey,
      scopes: input.scopes,
      revokedAt: undefined,
    });
    return id;
  }

  function seedPendingFile(businessId: string) {
    const fileId = nextId("file");
    files.set(fileId, { _id: fileId, businessId, status: "pending", storageId: undefined });
    return fileId;
  }

  async function dispatch(name: string, args: any): Promise<any> {
    switch (name) {
      case "apiKeys:verifyByHash": {
        for (const key of apiKeys.values()) {
          if (key.hashedKey === args.hashedKey && !key.revokedAt) return key;
        }
        return null;
      }
      case "apiKeys:touchLastUsed":
        return null;
      case "files:completeUpload": {
        const file = files.get(args.fileId);
        if (!file || file.businessId !== args.businessId) {
          return null;
        }
        file.status = "complete";
        file.storageId = args.storageId;
        return {
          fileId: args.fileId,
          url: `https://fake.convex.cloud/api/storage/${args.storageId}`,
        };
      }
      case "idempotencyKeys:beginOrReplay": {
        const mapKey = `${args.businessId}|${args.route}|${args.key}`;
        for (const record of idempotency.values()) {
          if (record.mapKey === mapKey) {
            if (record.requestHash !== args.requestHash) return { outcome: "conflict" };
            if (record.status === "in_progress") return { outcome: "conflict" };
            return {
              outcome: "replay",
              responseStatus: record.responseStatus,
              responseBody: record.responseBody,
            };
          }
        }
        const id = nextId("idem");
        idempotency.set(id, { id, mapKey, requestHash: args.requestHash, status: "in_progress" });
        return { outcome: "began", id };
      }
      case "idempotencyKeys:complete": {
        const record = idempotency.get(args.id);
        if (record) {
          record.status = "completed";
          record.responseStatus = args.responseStatus;
          record.responseBody = args.responseBody;
        }
        return null;
      }
      default:
        throw new Error(`Unhandled fake Convex function in test: ${name}`);
    }
  }

  return { apiKeys, files, idempotency, reset, seedApiKey, seedPendingFile, dispatch };
});

vi.mock("convex/browser", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    ConvexHttpClient: class {
      constructor(_url: string) {}
      async query(fnRef: unknown, args: unknown) {
        return backend.dispatch(getFunctionName(fnRef as never), args);
      }
      async mutation(fnRef: unknown, args: unknown) {
        return backend.dispatch(getFunctionName(fnRef as never), args);
      }
    },
  };
});

const { POST } = await import("./route");

const RAW_KEY_A = "tm_test_complete_business_a_secret";
const RAW_KEY_B = "tm_test_complete_business_b_secret";
const RAW_KEY_READONLY = "tm_test_complete_readonly_secret";

async function seedTwoBusinesses() {
  await backend.seedApiKey({
    businessId: "business_a",
    hashedKey: await hashApiKey(RAW_KEY_A),
    scopes: ["read", "write"],
  });
  await backend.seedApiKey({
    businessId: "business_b",
    hashedKey: await hashApiKey(RAW_KEY_B),
    scopes: ["read", "write"],
  });
  await backend.seedApiKey({
    businessId: "business_a",
    hashedKey: await hashApiKey(RAW_KEY_READONLY),
    scopes: ["read"],
  });
}

function postRequest(opts: {
  bearer?: string;
  idempotencyKey?: string;
  body?: unknown;
}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new Request("https://api.thismade.internal/v1/files/complete", {
    method: "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

beforeEach(() => {
  backend.reset();
});

describe("POST /v1/files/complete", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(401);
  });

  it("requires the write scope", async () => {
    await seedTwoBusinesses();
    const fileId = backend.seedPendingFile("business_a");
    const res = await POST(
      postRequest({
        bearer: RAW_KEY_READONLY,
        idempotencyKey: "req-1",
        body: { fileId, storageId: "storage_1" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("requires an Idempotency-Key header", async () => {
    await seedTwoBusinesses();
    const fileId = backend.seedPendingFile("business_a");
    const res = await POST(
      postRequest({ bearer: RAW_KEY_A, body: { fileId, storageId: "storage_1" } }),
    );
    expect(res.status).toBe(400);
  });

  it("validates fileId and storageId are present", async () => {
    await seedTwoBusinesses();
    const res = await POST(
      postRequest({ bearer: RAW_KEY_A, idempotencyKey: "req-1", body: {} }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("completes the caller's own pending upload and returns a permanent url", async () => {
    await seedTwoBusinesses();
    const fileId = backend.seedPendingFile("business_a");
    const res = await POST(
      postRequest({
        bearer: RAW_KEY_A,
        idempotencyKey: "req-1",
        body: { fileId, storageId: "storage_abc" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.fileId).toBe(fileId);
    expect(body.data.url).toContain("storage_abc");
  });

  it("returns not_found (404), never forbidden (403), for another business's fileId", async () => {
    await seedTwoBusinesses();
    const fileIdOwnedByA = backend.seedPendingFile("business_a");

    const res = await POST(
      postRequest({
        bearer: RAW_KEY_B,
        idempotencyKey: "req-1",
        body: { fileId: fileIdOwnedByA, storageId: "storage_abc" },
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("returns not_found for a fileId that never existed, indistinguishable from a cross-tenant one", async () => {
    await seedTwoBusinesses();
    const res = await POST(
      postRequest({
        bearer: RAW_KEY_A,
        idempotencyKey: "req-1",
        body: { fileId: "file_does_not_exist", storageId: "storage_abc" },
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("replays the cached response on a duplicate request instead of completing twice", async () => {
    await seedTwoBusinesses();
    const fileId = backend.seedPendingFile("business_a");
    const body = { fileId, storageId: "storage_abc" };

    const first = await POST(postRequest({ bearer: RAW_KEY_A, idempotencyKey: "dup-1", body }));
    const firstBody = await first.json();
    expect(first.status).toBe(200);

    const second = await POST(postRequest({ bearer: RAW_KEY_A, idempotencyKey: "dup-1", body }));
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody).toEqual(firstBody);
  });
});
