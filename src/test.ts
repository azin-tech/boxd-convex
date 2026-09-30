/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the boxd component with a `convex-test` instance:
 *
 * ```ts
 * import { convexTest } from "convex-test";
 * import boxdTest from "@boxd-sh/convex/test";
 *
 * const t = convexTest(schema, modules);
 * boxdTest.register(t);
 * ```
 *
 * @param name The name the app installed the component under. Default "boxd".
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "boxd",
) {
  t.registerComponent(name, schema, modules);
}

export default { register, schema, modules };
