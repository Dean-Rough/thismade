/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * Hand-generated offline — see the note in dataModel.ts and DECISIONS.md.
 * Backed by `anyApi` at runtime (Convex's documented codegen-free fallback:
 * https://docs.convex.dev/generated-api/api#the-anyapi-object) so calls are
 * fully functional; only static autocomplete is hand-maintained here instead
 * of derived from a live deployment.
 *
 * @module
 */

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import { anyApi } from "convex/server";
import type * as apiKeys from "../apiKeys.js";
import type * as businesses from "../businesses.js";
import type * as files from "../files.js";
import type * as idempotencyKeys from "../idempotencyKeys.js";
import type * as orders from "../orders.js";
import type * as payouts from "../payouts.js";
import type * as products from "../products.js";

const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  businesses: typeof businesses;
  files: typeof files;
  idempotencyKeys: typeof idempotencyKeys;
  orders: typeof orders;
  payouts: typeof payouts;
  products: typeof products;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<typeof fullApi, FunctionReference<any, "public">> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">> = anyApi as any;
