import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
process.env.CONVEX_SERVICE_SECRET = "test-secret";

// Fake Convex backend, mirroring app/v1/business/route.test.ts's approach:
// mock the wire boundary (`convex/browser`) rather than the route's own
// logic, so the route runs for real against a seeded api key.
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

  async function dispatch(name: string, args: any): Promise<any> {
    switch (name) {
      case "apiKeysActions:verifyByHash": {
        for (const key of apiKeys.values()) {
          if (key.hashedKey === args.hashedKey && !key.revokedAt) return key;
        }
        return null;
      }
      case "apiKeysActions:touchLastUsed":
        return null;
      case "filesActions:createPendingUpload": {
        const fileId = nextId("file");
        files.set(fileId, { _id: fileId, businessId: args.businessId, status: "pending" });
        return { fileId, uploadUrl: `https://fake.convex.cloud/api/storage/upload?token=${fileId}` };
      }
      case "idempotencyKeysActions:beginOrReplay": {
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
      case "idempotencyKeysActions:complete": {
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

  return { apiKeys, files, idempotency, reset, seedApiKey, dispatch };
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
      async action(fnRef: unknown, args: unknown) {
        return backend.dispatch(getFunctionName(fnRef as never), args);
      }
    },
  };
});

const { POST } = await import("./route");

const RAW_KEY_WRITE = "tm_test_files_write_secret";
const RAW_KEY_READONLY = "tm_test_files_readonly_secret";

async function seedKeys() {
  await backend.seedApiKey({
    businessId: "business_a",
    hashedKey: await hashApiKey(RAW_KEY_WRITE),
    scopes: ["read", "write"],
  });
  await backend.seedApiKey({
    businessId: "business_a",
    hashedKey: await hashApiKey(RAW_KEY_READONLY),
    scopes: ["read"],
  });
}

function postRequest(opts: { bearer?: string; idempotencyKey?: string }) {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new Request("https://api.thismade.internal/v1/files", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  backend.reset();
});

describe("POST /v1/files", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(401);
  });

  it("requires the write scope", async () => {
    await seedKeys();
    const res = await POST(postRequest({ bearer: RAW_KEY_READONLY, idempotencyKey: "req-1" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden_scope");
  });

  it("requires an Idempotency-Key header", async () => {
    await seedKeys();
    const res = await POST(postRequest({ bearer: RAW_KEY_WRITE }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("returns a fileId and uploadUrl in the {data,hint,next_action} envelope", async () => {
    await seedKeys();
    const res = await POST(postRequest({ bearer: RAW_KEY_WRITE, idempotencyKey: "req-1" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("hint");
    expect(body).toHaveProperty("next_action");
    expect(body.data.fileId).toBeTruthy();
    expect(body.data.uploadUrl).toMatch(/^https:\/\//);
  });
});
