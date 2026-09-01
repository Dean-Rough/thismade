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
import type * as agentContextFilesActions from "../agentContextFilesActions.js";
import type * as agentEvents from "../agentEvents.js";
import type * as agentEventsActions from "../agentEventsActions.js";
import type * as agentSkills from "../agentSkills.js";
import type * as agentSkillsActions from "../agentSkillsActions.js";
import type * as agentTasks from "../agentTasks.js";
import type * as agentTasksActions from "../agentTasksActions.js";
import type * as apiKeys from "../apiKeys.js";
import type * as apiKeysActions from "../apiKeysActions.js";
import type * as businesses from "../businesses.js";
import type * as businessesActions from "../businessesActions.js";
import type * as creditLedger from "../creditLedger.js";
import type * as creditLedgerActions from "../creditLedgerActions.js";
import type * as dispatcher from "../dispatcher.js";
import type * as domains from "../domains.js";
import type * as domainsActions from "../domainsActions.js";
import type * as domainsVerify from "../domainsVerify.js";
import type * as files from "../files.js";
import type * as filesActions from "../filesActions.js";
import type * as idempotencyKeys from "../idempotencyKeys.js";
import type * as idempotencyKeysActions from "../idempotencyKeysActions.js";
import type * as lib_agentContextTemplates from "../lib/agentContextTemplates.js";
import type * as lib_apiKeyCrypto from "../lib/apiKeyCrypto.js";
import type * as lib_events from "../lib/events.js";
import type * as lib_llmClient from "../lib/llmClient.js";
import type * as lib_richContent from "../lib/richContent.js";
import type * as lib_sandboxProvider from "../lib/sandboxProvider.js";
import type * as lib_serviceAuth from "../lib/serviceAuth.js";
import type * as lib_tenancy from "../lib/tenancy.js";
import type * as lib_workerLoop from "../lib/workerLoop.js";
import type * as lib_workerPrompts from "../lib/workerPrompts.js";
import type * as lib_workerTools from "../lib/workerTools.js";
import type * as orders from "../orders.js";
import type * as ordersActions from "../ordersActions.js";
import type * as payouts from "../payouts.js";
import type * as payoutsActions from "../payoutsActions.js";
import type * as products from "../products.js";
import type * as productsActions from "../productsActions.js";
import type * as seedAgentContext from "../seedAgentContext.js";
import type * as workerRunner from "../workerRunner.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentContextFiles: typeof agentContextFiles;
  agentContextFilesActions: typeof agentContextFilesActions;
  agentEvents: typeof agentEvents;
  agentEventsActions: typeof agentEventsActions;
  agentSkills: typeof agentSkills;
  agentSkillsActions: typeof agentSkillsActions;
  agentTasks: typeof agentTasks;
  agentTasksActions: typeof agentTasksActions;
  apiKeys: typeof apiKeys;
  apiKeysActions: typeof apiKeysActions;
  businesses: typeof businesses;
  businessesActions: typeof businessesActions;
  creditLedger: typeof creditLedger;
  creditLedgerActions: typeof creditLedgerActions;
  dispatcher: typeof dispatcher;
  domains: typeof domains;
  domainsActions: typeof domainsActions;
  domainsVerify: typeof domainsVerify;
  files: typeof files;
  filesActions: typeof filesActions;
  idempotencyKeys: typeof idempotencyKeys;
  idempotencyKeysActions: typeof idempotencyKeysActions;
  "lib/agentContextTemplates": typeof lib_agentContextTemplates;
  "lib/apiKeyCrypto": typeof lib_apiKeyCrypto;
  "lib/events": typeof lib_events;
  "lib/llmClient": typeof lib_llmClient;
  "lib/richContent": typeof lib_richContent;
  "lib/sandboxProvider": typeof lib_sandboxProvider;
  "lib/serviceAuth": typeof lib_serviceAuth;
  "lib/tenancy": typeof lib_tenancy;
  "lib/workerLoop": typeof lib_workerLoop;
  "lib/workerPrompts": typeof lib_workerPrompts;
  "lib/workerTools": typeof lib_workerTools;
  orders: typeof orders;
  ordersActions: typeof ordersActions;
  payouts: typeof payouts;
  payoutsActions: typeof payoutsActions;
  products: typeof products;
  productsActions: typeof productsActions;
  seedAgentContext: typeof seedAgentContext;
  workerRunner: typeof workerRunner;
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
