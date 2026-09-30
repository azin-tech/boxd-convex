/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import boxdTest from "@boxd-sh/convex/test";
import { test, vi } from "vitest";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.*s");

// An app that installs the component registers it with its test instance.
export function initConvexTest() {
  vi.stubEnv("BOXD_API_KEY", "bxd_test_key");
  const t = convexTest(schema, modules);
  boxdTest.register(t);
  return t;
}

test("setup", () => {});
