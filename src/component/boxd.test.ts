/// <reference types="vite/client" />
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { exchangeUrl } from "./boxd.js";
import {
  API_KEY,
  cloud,
  initConvexTest,
  resetCloud,
  stubExchange,
} from "./setup.test.js";

vi.mock(
  "@boxd-sh/sdk/web",
  async () => (await import("./setup.test.js")).fakeSdk,
);

beforeEach(() => {
  resetCloud();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function errorData(error: unknown) {
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: string; message: string }>).data;
}

describe("exchangeUrl", () => {
  test.each([
    ["https://boxd.sh:9443", "https://app.boxd.sh/api/v1/auth/token"],
    ["boxd.sh:9443", "https://app.boxd.sh/api/v1/auth/token"],
    [
      "https://staging.boxd.sh:9443/",
      "https://app.staging.boxd.sh/api/v1/auth/token",
    ],
    ["https://app.boxd.sh", "https://app.boxd.sh/api/v1/auth/token"],
    ["http://localhost:8080", "http://localhost:8080/api/v1/auth/token"],
    ["localhost:8080", "http://localhost:8080/api/v1/auth/token"],
    ["127.0.0.1:9443", "http://127.0.0.1:9443/api/v1/auth/token"],
    ["https://10.0.0.5:9443", "https://10.0.0.5:9443/api/v1/auth/token"],
  ])("%s → %s", (baseURL, expected) => {
    expect(exchangeUrl(baseURL)).toBe(expected);
  });
});

describe("session tokens", () => {
  test("one exchange serves every later action", async () => {
    const exchanges = stubExchange();
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {});
    await t.action(api.machines.refresh, { machineId });
    await t.action(api.exec.run, { machineId, command: "true" });

    expect(exchanges).toEqual([
      {
        url: "https://app.boxd.sh/api/v1/auth/token",
        apiKey: API_KEY,
        token: "token-1",
      },
    ]);
    expect(new Set(cloud.tokens)).toEqual(new Set(["token-1"]));
  });

  test("a token near its expiry is exchanged again", async () => {
    // 4 minutes left is inside the 5 minute refresh margin.
    const exchanges = stubExchange({ ttlSeconds: 240 });
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {
      waitUntilReady: false,
    });
    await t.action(api.machines.refresh, { machineId });
    expect(exchanges.map((e) => e.token)).toEqual(["token-1", "token-2"]);
    const session = await t.run(async (ctx) =>
      ctx.db.query("sessions").collect(),
    );
    expect(session).toHaveLength(1);
  });

  test("a revoked cached token is dropped and the call retried once", async () => {
    const exchanges = stubExchange();
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {});
    cloud.revoked.add("token-1");
    cloud.calls = [];

    const row = await t.action(api.machines.refresh, { machineId });
    expect(row.status).toBe("running");
    expect(exchanges.map((e) => e.token)).toEqual(["token-1", "token-2"]);
    expect(cloud.calls).toEqual([`get ${machineId}`, `get ${machineId}`]);
  });

  test("a failed refresh falls back to a token that still works", async () => {
    // 4 minutes left: inside the refresh margin, but not expired.
    const exchanges = stubExchange({ ttlSeconds: 240 });
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {
      waitUntilReady: false,
    });
    stubExchange({ respond: () => new Response("slow down", { status: 429 }) });
    const row = await t.action(api.machines.refresh, { machineId });
    expect(row.status).toBe("pending");
    expect(exchanges).toHaveLength(1);
    expect(cloud.tokens.at(-1)).toBe("token-1");
  });

  test("an expired token is never used as a fallback", async () => {
    const t = initConvexTest();
    await t.mutation(internal.sessions.put, {
      keyHash: "unused",
      token: "stale",
      expiresAt: 1,
    });
    stubExchange({ respond: () => new Response("slow down", { status: 429 }) });
    const error = await t
      .action(api.machines.create, {})
      .catch((e: unknown) => e);
    expect(errorData(error).code).toBe("RATE_LIMITED");
    expect(cloud.tokens).toEqual([]);
  });

  test("a fresh token boxd rejects is not retried", async () => {
    const exchanges = stubExchange();
    const t = initConvexTest();
    cloud.revoked.add("token-1");
    const error = await t
      .action(api.machines.create, {})
      .catch((e: unknown) => e);
    expect(errorData(error).code).toBe("UNAUTHENTICATED");
    expect(exchanges).toHaveLength(1);
  });

  test("a different endpoint gets its own session", async () => {
    const exchanges = stubExchange();
    const t = initConvexTest();
    await t.action(api.machines.create, {});
    vi.stubEnv("BOXD_BASE_URL", "https://staging.boxd.sh:9443");
    await t.action(api.machines.create, {});
    expect(exchanges.map((e) => e.url)).toEqual([
      "https://app.boxd.sh/api/v1/auth/token",
      "https://app.staging.boxd.sh/api/v1/auth/token",
    ]);
  });

  test("a concurrent writer never replaces a longer-lived token", async () => {
    const t = initConvexTest();
    const keyHash = "h";
    await t.mutation(internal.sessions.put, {
      keyHash,
      token: "long",
      expiresAt: 2_000,
    });
    await t.mutation(internal.sessions.put, {
      keyHash,
      token: "short",
      expiresAt: 1_000,
    });
    expect(await t.query(internal.sessions.get, { keyHash })).toEqual({
      token: "long",
      expiresAt: 2_000,
    });
    // Dropping a token another action already replaced is a no-op.
    await t.mutation(internal.sessions.drop, { keyHash, token: "short" });
    expect(await t.query(internal.sessions.get, { keyHash })).not.toBeNull();
    await t.mutation(internal.sessions.drop, { keyHash, token: "long" });
    expect(await t.query(internal.sessions.get, { keyHash })).toBeNull();
  });
});

describe("exchange failures", () => {
  test.each([
    [401, "UNAUTHENTICATED", "boxd auth keys create"],
    [429, "RATE_LIMITED", "Retry after a minute"],
    [503, "UNAVAILABLE", "failed with 503"],
    [400, "BOXD_ERROR", "failed with 400"],
  ])("HTTP %i → %s", async (status, code, hint) => {
    stubExchange({ respond: () => new Response("nope", { status }) });
    const t = initConvexTest();
    const error = await t
      .action(api.machines.create, {})
      .catch((e: unknown) => e);
    const data = errorData(error);
    expect(data.code).toBe(code);
    expect(data.message).toContain(hint);
    expect(cloud.calls).toEqual([]);
  });

  test("a malformed exchange response is an error, not a bad token", async () => {
    stubExchange({ respond: () => Response.json({ token: 42 }) });
    const t = initConvexTest();
    const error = await t
      .action(api.machines.create, {})
      .catch((e: unknown) => e);
    expect(errorData(error)).toMatchObject({
      code: "BOXD_ERROR",
      message: expect.stringContaining("malformed"),
    });
  });

  test("an unreachable endpoint is UNAVAILABLE", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const t = initConvexTest();
    const error = await t
      .action(api.machines.create, {})
      .catch((e: unknown) => e);
    expect(errorData(error).code).toBe("UNAVAILABLE");
  });

  test("an empty BOXD_API_KEY names the fix", async () => {
    stubExchange();
    const t = initConvexTest();
    vi.stubEnv("BOXD_API_KEY", "  ");
    const error = await t
      .action(api.machines.create, {})
      .catch((e: unknown) => e);
    const data = errorData(error);
    expect(data.code).toBe("UNAUTHENTICATED");
    expect(data.message).toContain("npx convex env set BOXD_API_KEY");
  });
});
