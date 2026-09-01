import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { getScoped } from "./lib/tenancy";
import type { Doc, Id } from "./_generated/dataModel";

// Internal-only (THI-42): fronted by filesActions.ts for the /v1 REST
// layer's use.
//
// Step 1 of the upload flow: mint a Convex-signed upload URL and record a
// "pending" row so the eventual `completeUpload` call has a businessId-scoped
// anchor to check against. The storageId isn't known until the caller actually
// PUTs bytes to `uploadUrl` (that's a direct HTTP call to Convex, outside this
// app), so it can't be recorded yet — see DECISIONS.md Phase 2 §files.
export const createPendingUpload = internalMutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const fileId = await ctx.db.insert("files", {
      businessId: args.businessId,
      status: "pending",
      createdAt: Date.now(),
    });
    return { fileId, uploadUrl };
  },
});

// Step 2: finalize. `fileId` is the tenancy anchor — it was only ever handed
// to the business that created it — so a cross-tenant fileId behaves exactly
// like an unknown one: `getScoped` returns null and the caller gets nothing
// back to distinguish "not yours" from "doesn't exist" (REST layer turns this
// into a 404, never a 403).
export const completeUpload = internalMutation({
  args: {
    businessId: v.id("businesses"),
    fileId: v.id("files"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args): Promise<{ fileId: Id<"files">; url: string } | null> => {
    const file = await getScoped<Doc<"files">>(ctx.db, args.fileId, args.businessId);
    if (!file) {
      return null;
    }

    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) {
      throw new Error("storage_object_not_found");
    }

    await ctx.db.patch(args.fileId, {
      storageId: args.storageId,
      status: "complete",
    });

    return { fileId: args.fileId, url };
  },
});
