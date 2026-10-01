/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cloud,
  conflict,
  resetCloud,
  stubExchange,
} from "../../src/component/setup.test.js";
import { api, internal } from "./_generated/api.js";
import { LIMITS } from "./demo.js";
import { initConvexTest } from "./setup.test.js";

vi.mock(
  "@boxd-sh/sdk/web",
  async () => (await import("../../src/component/setup.test.js")).fakeSdk,
);

beforeEach(() => {
  resetCloud();
  stubExchange();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Convex Auth puts `userId|sessionId` in the subject. */
const visitor = (n: number) => ({ subject: `user${n}|session${n}` });

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e,
  );
  return (error as { data: { code: string; message: string } }).data;
}

describe("demo", () => {
  test("a visitor gets a small machine that destroys itself", async () => {
    const t = initConvexTest().withIdentity(visitor(1));
    const machineId = await t.action(api.demo.createMachine, {});
    expect(cloud.lastCreate).toMatchObject({
      // Isolated: the page runs arbitrary visitor commands.
      isolated: true,
      config: { vcpu: 1, autoDestroyTimeout: LIMITS.lifetimeMs / 1000 },
    });

    const [row] = await t.query(api.demo.machines, {});
    expect(row.machine).toMatchObject({ machineId, ownerId: "user1" });
    expect(row.expiresAt).toBeGreaterThan(Date.now());
    expect(await t.query(api.demo.usage, {})).toMatchObject({ running: 1 });
  });

  test("signed-out callers get nothing", async () => {
    const t = initConvexTest();
    expect(await t.query(api.demo.machines, {})).toEqual([]);
    const data = await rejection(t.action(api.demo.createMachine, {}));
    expect(data.code).toBe("UNAUTHENTICATED");
    expect(cloud.calls).toEqual([]);
  });

  test("a visitor runs at most two machines", async () => {
    const t = initConvexTest().withIdentity(visitor(1));
    const first = await t.action(api.demo.createMachine, {});
    await t.action(api.demo.forkMachine, { machineId: first });
    cloud.calls = [];

    const data = await rejection(t.action(api.demo.createMachine, {}));
    expect(data.code).toBe("RATE_LIMITED");
    expect(cloud.calls).toEqual([]);

    // Destroying one frees its slot.
    await t.action(api.demo.destroyMachine, { machineId: first });
    await t.action(api.demo.createMachine, {});
    expect(await t.query(api.demo.machines, {})).toHaveLength(2);
  });

  test("the demo runs at most ten machines overall", async () => {
    const t = initConvexTest();
    for (let n = 0; n < LIMITS.machines; n++) {
      await t.withIdentity(visitor(n)).action(api.demo.createMachine, {});
    }
    const data = await rejection(
      t.withIdentity(visitor(99)).action(api.demo.createMachine, {}),
    );
    expect(data.code).toBe("RATE_LIMITED");
    expect(cloud.machines.size).toBe(LIMITS.machines);
  });

  test("a failed create frees its slot", async () => {
    const t = initConvexTest().withIdentity(visitor(1));
    cloud.failures.set("create", conflict("no capacity"));
    await rejection(t.action(api.demo.createMachine, {}));
    expect(await t.query(api.demo.usage, {})).toMatchObject({ running: 0 });
  });

  test("visitors can't reach each other's machines", async () => {
    const t = initConvexTest();
    const machineId = await t
      .withIdentity(visitor(1))
      .action(api.demo.createMachine, {});
    const other = t.withIdentity(visitor(2));

    expect(await other.query(api.demo.machines, {})).toEqual([]);
    expect(await other.query(api.demo.executions, { machineId })).toEqual([]);
    for (const call of [
      () => other.action(api.demo.runCommand, { machineId, command: "id" }),
      () => other.action(api.demo.setState, { machineId, to: "pause" }),
      () => other.action(api.demo.forkMachine, { machineId }),
      () => other.action(api.demo.destroyMachine, { machineId }),
    ]) {
      expect((await rejection(call())).code).toBe("NOT_FOUND");
    }
    expect(cloud.machines.get(machineId)?.status).toBe("running");
    // The failed fork gave its slot back.
    expect(await t.query(api.demo.usage, {})).toMatchObject({ running: 1 });
  });

  test("commands are bounded and rate limited", async () => {
    const t = initConvexTest().withIdentity(visitor(1));
    const machineId = await t.action(api.demo.createMachine, {});

    await t.action(api.demo.runCommand, { machineId, command: "echo hi" });
    expect(cloud.lastParams).toMatchObject({
      timeout: LIMITS.commandTimeoutMs,
    });

    const tooLong = "x".repeat(LIMITS.commandLength + 1);
    expect(
      (
        await rejection(
          t.action(api.demo.runCommand, { machineId, command: tooLong }),
        )
      ).code,
    ).toBe("INVALID_ARGUMENT");

    // The first command spent one token of the bucket.
    for (let n = 1; n < 20; n++) {
      await t.action(api.demo.runCommand, { machineId, command: "true" });
    }
    const data = await rejection(
      t.action(api.demo.runCommand, { machineId, command: "true" }),
    );
    expect(data.code).toBe("RATE_LIMITED");
    expect(await t.query(api.demo.executions, { machineId })).toHaveLength(20);
  });

  test("a command wakes a paused machine and the badge catches up", async () => {
    const t = initConvexTest().withIdentity(visitor(1));
    const machineId = await t.action(api.demo.createMachine, {});
    await t.action(api.demo.setState, { machineId, to: "pause" });
    expect((await t.query(api.demo.machines, {}))[0]?.machine?.status).toBe(
      "suspended",
    );

    await t.action(api.demo.runCommand, { machineId, command: "echo hi" });
    // exec auto-woke it; runCommand refreshed the row, so it no longer
    // shows paused.
    expect((await t.query(api.demo.machines, {}))[0]?.machine?.status).toBe(
      "running",
    );
  });

  test("refresh catches a machine boxd suspended on its own", async () => {
    const t = initConvexTest().withIdentity(visitor(1));
    const machineId = await t.action(api.demo.createMachine, {});

    // boxd suspends it after idle, without going through the component.
    cloud.machines.get(machineId)!.status = "suspended";
    await t.action(api.demo.refreshMachine, { machineId });
    expect((await t.query(api.demo.machines, {}))[0]?.machine?.status).toBe(
      "suspended",
    );
  });

  test("refresh of an already-destroyed machine is quiet", async () => {
    const t = initConvexTest().withIdentity(visitor(1));
    const machineId = await t.action(api.demo.createMachine, {});
    cloud.machines.delete(machineId);
    // No throw: the sweep may have destroyed it between polls.
    await t.action(api.demo.refreshMachine, { machineId });
  });

  test("the sweep destroys machines whose time is up", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = initConvexTest();
    const old = await t
      .withIdentity(visitor(1))
      .action(api.demo.createMachine, {});
    vi.setSystemTime(Date.now() + LIMITS.lifetimeMs / 2);
    const fresh = await t
      .withIdentity(visitor(2))
      .action(api.demo.createMachine, {});

    vi.setSystemTime(Date.now() + LIMITS.lifetimeMs / 2 + 1);
    await t.action(internal.demo.sweep, {});

    expect(cloud.machines.has(old)).toBe(false);
    expect(cloud.machines.get(fresh)?.status).toBe("running");
    expect(
      await t.withIdentity(visitor(1)).query(api.demo.machines, {}),
    ).toEqual([]);
    expect(await t.query(api.demo.usage, {})).toMatchObject({ running: 1 });
  });

  test("the sweep keeps a slot when boxd can't destroy its machine yet", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t = initConvexTest();
    const machineId = await t
      .withIdentity(visitor(1))
      .action(api.demo.createMachine, {});
    vi.setSystemTime(Date.now() + LIMITS.lifetimeMs + 1);

    cloud.failures.set("delete", conflict("VM is migrating"));
    await t.action(internal.demo.sweep, {});
    expect(await t.query(api.demo.usage, {})).toMatchObject({ running: 1 });

    await t.action(internal.demo.sweep, {});
    expect(cloud.machines.has(machineId)).toBe(false);
    expect(await t.query(api.demo.usage, {})).toMatchObject({ running: 0 });
  });
});
