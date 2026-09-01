import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Id } from "./_generated/dataModel";

// Public entry points for convex/files.ts's internal functions, gated by
// the shared service secret (THI-42).
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const createPendingUpload = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (
    ctx,
    { secret, ...args },
  ): Promise<{ fileId: Id<"files">; uploadUrl: string }> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.files.createPendingUpload, args);
  },
});

export const completeUpload = action({
  args: {
    businessId: v.id("businesses"),
    fileId: v.id("files"),
    storageId: v.id("_storage"),
    secret: v.string(),
  },
  handler: async (
    ctx,
    { secret, ...args },
  ): Promise<{ fileId: Id<"files">; url: string } | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.files.completeUpload, args);
  },
});
