import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { isBoxdError } from "./index.js";

describe("isBoxdError", () => {
  const notFound = new ConvexError({ code: "NOT_FOUND", message: "gone" });

  test("matches the component's coded errors", () => {
    expect(isBoxdError(notFound)).toBe(true);
    expect(isBoxdError(notFound, "NOT_FOUND")).toBe(true);
    expect(isBoxdError(notFound, "CONFLICT")).toBe(false);
  });

  test("ignores everything else", () => {
    expect(isBoxdError(new Error("NOT_FOUND"))).toBe(false);
    expect(isBoxdError(new ConvexError("NOT_FOUND"))).toBe(false);
    expect(isBoxdError(new ConvexError({ code: "NOT_FOUND" }))).toBe(false);
    expect(isBoxdError(null)).toBe(false);
  });
});
