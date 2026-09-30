import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { errorMessage, isNotFound, toConvexError } from "./errors.js";
import { MAX_STORED_ERROR, clampLimit, truncate } from "./limits.js";
import { boundedTimeout, requireSubdomainLabel } from "./validate.js";

const sdk = (name: string, grpcCode: number | undefined, message: string) =>
  Object.assign(new Error(message), { name, grpcCode });

describe("toConvexError", () => {
  test.each([
    [3, "INVALID_ARGUMENT"],
    [4, "TIMEOUT"],
    [5, "NOT_FOUND"],
    [6, "CONFLICT"],
    [7, "PERMISSION_DENIED"],
    [8, "RATE_LIMITED"],
    [9, "CONFLICT"],
    [14, "UNAVAILABLE"],
    [16, "UNAUTHENTICATED"],
    [13, "BOXD_ERROR"],
  ])("gRPC status %i → %s", (grpcCode, code) => {
    expect(toConvexError(sdk("APIStatusError", grpcCode, "m")).data).toEqual({
      code,
      message: "m",
    });
  });

  test("an SDK error raised before the wire maps by class", () => {
    expect(
      toConvexError(sdk("AuthenticationError", undefined, "no key")).data.code,
    ).toBe("UNAUTHENTICATED");
    expect(
      toConvexError(sdk("APIConnectionError", undefined, "reset")).data.code,
    ).toBe("UNAVAILABLE");
  });

  test("the SDK's client-side deadlines map to TIMEOUT", () => {
    for (const message of [
      "exec timed out after 5ms",
      "machine m did not reach 'running' within 90000ms",
      "machine m reached 'running' but exec did not succeed within 90000ms",
    ]) {
      expect(
        toConvexError(sdk("BoxdError", undefined, message)).data.code,
      ).toBe("TIMEOUT");
    }
  });

  test("a coded ConvexError passes through unchanged", () => {
    const original = new ConvexError({ code: "CONFLICT", message: "x" });
    expect(toConvexError(original)).toBe(original);
  });

  test("anything else is BOXD_ERROR with a bounded message", () => {
    const converted = toConvexError("x".repeat(MAX_STORED_ERROR * 2));
    expect(converted.data.code).toBe("BOXD_ERROR");
    expect(converted.data.message.length).toBe(MAX_STORED_ERROR);
  });

  test("isNotFound reads raw and converted errors alike", () => {
    const raw = sdk("NotFoundError", 5, "gone");
    expect(isNotFound(raw)).toBe(true);
    expect(isNotFound(toConvexError(raw))).toBe(true);
    expect(isNotFound(new Error("gone"))).toBe(false);
  });

  test("errorMessage reads a ConvexError's message", () => {
    expect(errorMessage(new ConvexError({ code: "X", message: "why" }))).toBe(
      "why",
    );
    expect(errorMessage(new ConvexError("plain"))).toBe("plain");
  });
});

describe("limits", () => {
  test("truncate is a hard bound, marker included", () => {
    expect(truncate("short", 10)).toBe("short");
    const cut = truncate("a".repeat(100), 20);
    expect(cut.length).toBe(20);
    expect(cut.endsWith("…[truncated]")).toBe(true);
  });

  test("clampLimit", () => {
    expect(clampLimit(undefined)).toBe(100);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(10.9)).toBe(10);
    expect(clampLimit(10_000)).toBe(500);
    expect(clampLimit(Number.NaN)).toBe(100);
  });

  test("boundedTimeout", () => {
    expect(boundedTimeout(undefined, 5, 10, "t")).toBe(5);
    expect(boundedTimeout(7.8, 5, 10, "t")).toBe(7);
    expect(boundedTimeout(99, 5, 10, "t")).toBe(10);
    expect(() => boundedTimeout(0, 5, 10, "t")).toThrow(ConvexError);
    expect(() => boundedTimeout(Number.NaN, 5, 10, "t")).toThrow(ConvexError);
  });

  test("requireSubdomainLabel", () => {
    for (const ok of ["a", "api", "a-1", "x".repeat(63)]) {
      expect(requireSubdomainLabel(ok)).toBe(ok);
    }
    for (const bad of ["", "-a", "a-", "A", "a_b", "a.b", "x".repeat(64)]) {
      expect(() => requireSubdomainLabel(bad)).toThrow(ConvexError);
    }
  });
});
