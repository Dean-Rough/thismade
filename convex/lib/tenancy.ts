import type { GenericDatabaseReader } from "convex/server";
import type { Id } from "../_generated/dataModel";

/**
 * The tenancy contract every businessId-scoped table must follow: fetching a
 * document that belongs to a different business is indistinguishable from the
 * document not existing. Callers translate a `null` result into HTTP 404 —
 * never 403 — so cross-tenant probing can't confirm a resource's existence.
 */
export async function getScoped<
  Doc extends { businessId: Id<"businesses"> },
>(
  db: GenericDatabaseReader<any>,
  id: Id<any>,
  businessId: Id<"businesses">,
): Promise<Doc | null> {
  const doc = (await db.get(id)) as Doc | null;
  if (!doc || doc.businessId !== businessId) {
    return null;
  }
  return doc;
}
