/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentContextFiles from "../agentContextFiles.js";
import type * as agentEvents from "../agentEvents.js";
import type * as agentTasks from "../agentTasks.js";
import type * as apiKeys from "../apiKeys.js";
import type * as businesses from "../businesses.js";
import type * as creditLedger from "../creditLedger.js";
import type * as files from "../files.js";
import type * as idempotencyKeys from "../idempotencyKeys.js";
import type * as lib_apiKeyCrypto from "../lib/apiKeyCrypto.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_richContent from "../lib/richContent.js";
import type * as lib_tenancy from "../lib/tenancy.js";
import type * as orders from "../orders.js";
import type * as payouts from "../payouts.js";
import type * as products from "../products.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentContextFiles: typeof agentContextFiles;
  agentEvents: typeof agentEvents;
  agentTasks: typeof agentTasks;
  apiKeys: typeof apiKeys;
  businesses: typeof businesses;
  creditLedger: typeof creditLedger;
  files: typeof files;
  idempotencyKeys: typeof idempotencyKeys;
  "lib/apiKeyCrypto": typeof lib_apiKeyCrypto;
  "lib/events": typeof lib_events;
  "lib/richContent": typeof lib_richContent;
  "lib/tenancy": typeof lib_tenancy;
  orders: typeof orders;
  payouts: typeof payouts;
  products: typeof products;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
