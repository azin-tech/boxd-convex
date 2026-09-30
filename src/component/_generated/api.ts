/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as boxd from "../boxd.js";
import type * as errors from "../errors.js";
import type * as exec from "../exec.js";
import type * as executions from "../executions.js";
import type * as files from "../files.js";
import type * as limits from "../limits.js";
import type * as machines from "../machines.js";
import type * as records from "../records.js";
import type * as sessions from "../sessions.js";
import type * as validate from "../validate.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  boxd: typeof boxd;
  errors: typeof errors;
  exec: typeof exec;
  executions: typeof executions;
  files: typeof files;
  limits: typeof limits;
  machines: typeof machines;
  records: typeof records;
  sessions: typeof sessions;
  validate: typeof validate;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
