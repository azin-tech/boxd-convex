/// <reference types="vite/client" />
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import {
  cloud,
  conflict,
  initConvexTest,
  resetCloud,
  stubExchange,
} from "./setup.test.js";

vi.mock(
  "@boxd-sh/sdk/web",
  async () => (await import("./setup.test.js")).fakeSdk,
);

/** The `data` of the coded ConvexError `promise` rejects with. */
async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConvexError);
  return (error as ConvexError<{ code: string; message: string }>).data;
}

beforeEach(() => {
  resetCloud();
  stubExchange();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("create", () => {
  test("stores the machine for its owner once it is ready", async () => {
    const t = initConvexTest();
    const row = await t.action(api.machines.create, {
      ownerId: "user-1",
      name: "dev-box",
      image: "node:22",
      vcpu: 1,
      memory: "4G",
      autoSuspendSeconds: 300,
      env: { SECRET: "s3cret" },
    });

    expect(row).toMatchObject({
      name: "dev-box",
      ownerId: "user-1",
      status: "running",
      url: "https://dev-box.boxd.test",
    });
    expect(cloud.calls).toEqual(["create", `waitUntilReady ${row.machineId}`]);
    // The environment reaches boxd but is never stored.
    expect(JSON.stringify(row)).not.toContain("s3cret");
    const stored = await t.query(api.machines.get, {
      machineId: row.machineId,
      ownerId: "user-1",
    });
    expect(stored).toEqual(row);
  });

  test("passes sizing and idle timers to boxd", async () => {
    const t = initConvexTest();
    await t.action(api.machines.create, {
      vcpu: 1,
      memory: "4G",
      autoSuspendSeconds: 300,
      autoDestroySeconds: 0,
      isolated: true,
      waitUntilReady: false,
    });
    expect(cloud.lastParams).toMatchObject({
      isolated: true,
      config: {
        vcpu: 1,
        memory: "4G",
        autoSuspendTimeout: 300,
        autoDestroyTimeout: 0,
      },
    });
  });

  test("skips the readiness wait on request", async () => {
    const t = initConvexTest();
    const row = await t.action(api.machines.create, { waitUntilReady: false });
    expect(row.status).toBe("pending");
    expect(cloud.calls).toEqual(["create"]);
  });

  test("caps the readiness timeout", async () => {
    const t = initConvexTest();
    await t.action(api.machines.create, { readyTimeoutMs: 10_000_000 });
    expect(cloud.lastParams).toEqual({ timeout: 480_000 });
  });

  test("rejects bad arguments before calling boxd", async () => {
    const t = initConvexTest();
    for (const args of [{ name: " " }, { readyTimeoutMs: -1 }]) {
      const data = await rejection(t.action(api.machines.create, args));
      expect(data.code).toBe("INVALID_ARGUMENT");
    }
    expect(cloud.calls).toEqual([]);
  });

  test("a readiness timeout keeps the row and names the machine", async () => {
    const t = initConvexTest();
    cloud.failures.set(
      "waitUntilReady",
      Object.assign(
        new Error("machine m did not reach 'running' within 120000ms"),
        { name: "BoxdError" },
      ),
    );
    const data = await rejection(
      t.action(api.machines.create, { ownerId: "user-1" }),
    );
    const [row] = await t.query(api.machines.list, { ownerId: "user-1" });
    // The machine exists and bills: the caller gets its id to act on.
    expect(data).toMatchObject({ code: "TIMEOUT", machineId: row.machineId });
    expect(row.status).toBe("pending");
    expect(row.lastError).toContain("did not reach 'running'");
  });

  test("a machine the row can't be written for is destroyed", async () => {
    const t = initConvexTest();
    cloud.malformedCreate = true;
    await expect(t.action(api.machines.create, {})).rejects.toThrow();
    // Never left running, and billing, with no row to find it by.
    expect(cloud.machines.size).toBe(0);
    expect(cloud.calls).toEqual(["create", "delete vm-1"]);
  });

  test("maps a quota refusal to RATE_LIMITED and stores nothing", async () => {
    const t = initConvexTest();
    cloud.failures.set(
      "create",
      Object.assign(new Error("VM quota exceeded"), {
        name: "RateLimitError",
        grpcCode: 8,
      }),
    );
    const data = await rejection(t.action(api.machines.create, {}));
    expect(data).toEqual({
      code: "RATE_LIMITED",
      message: "VM quota exceeded",
    });
    expect(await t.query(api.machines.list, {})).toEqual([]);
  });
});

describe("owner fencing", () => {
  test("reads and actions only reach the owner's machines", async () => {
    const t = initConvexTest();
    const mine = await t.action(api.machines.create, { ownerId: "user-1" });
    const unowned = await t.action(api.machines.create, {});
    cloud.calls = [];

    expect(
      await t.query(api.machines.get, {
        machineId: mine.machineId,
        ownerId: "user-2",
      }),
    ).toBeNull();
    // A machine made with an owner is not reachable without one.
    expect(
      await t.query(api.machines.get, { machineId: mine.machineId }),
    ).toBeNull();
    expect(
      (await t.query(api.machines.list, { ownerId: "user-1" })).map(
        (m) => m.machineId,
      ),
    ).toEqual([mine.machineId]);
    expect(
      (await t.query(api.machines.list, {})).map((m) => m.machineId),
    ).toEqual([unowned.machineId]);

    // Started one at a time: a call started early could reject before
    // `rejection` handles it, which Vitest reports as an unhandled error.
    for (const call of [
      () =>
        t.action(api.machines.destroy, {
          machineId: mine.machineId,
          ownerId: "user-2",
        }),
      () =>
        t.action(api.exec.run, {
          machineId: mine.machineId,
          ownerId: "user-2",
          command: "id",
        }),
      () =>
        t.action(api.files.readFile, {
          machineId: mine.machineId,
          path: "/etc/hostname",
        }),
    ]) {
      expect((await rejection(call())).code).toBe("NOT_FOUND");
    }
    // Nothing reached boxd.
    expect(cloud.calls).toEqual([]);
  });

  test("a machine the component never created is not reachable", async () => {
    const t = initConvexTest();
    const foreign = cloud.add();
    const data = await rejection(
      t.action(api.machines.stop, { machineId: foreign.id }),
    );
    expect(data.code).toBe("NOT_FOUND");
    expect(cloud.machines.get(foreign.id)?.status).toBe("running");
  });
});

describe("fork", () => {
  test("copies the owner and records the source", async () => {
    const t = initConvexTest();
    const source = await t.action(api.machines.create, { ownerId: "user-1" });
    const fork = await t.action(api.machines.fork, {
      machineId: source.machineId,
      ownerId: "user-1",
      name: "branch",
    });
    expect(fork).toMatchObject({
      ownerId: "user-1",
      forkedFrom: source.machineId,
      status: "running",
    });
    expect(fork.machineId).not.toBe(source.machineId);
    expect(
      await t.query(api.machines.list, { ownerId: "user-1" }),
    ).toHaveLength(2);
  });
});

describe("transitions", () => {
  test("pause, resume, stop and start report boxd's status", async () => {
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {});
    expect((await t.action(api.machines.pause, { machineId })).status).toBe(
      "suspended",
    );
    expect((await t.action(api.machines.resume, { machineId })).status).toBe(
      "running",
    );
    expect((await t.action(api.machines.stop, { machineId })).status).toBe(
      "stopped",
    );
    expect((await t.action(api.machines.start, { machineId })).status).toBe(
      "running",
    );
  });

  test("hibernate waits until boxd reports hibernated", async () => {
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {});
    const row = await t.action(api.machines.hibernate, { machineId });
    expect(row.status).toBe("hibernated");
    expect((await t.action(api.machines.wake, { machineId })).status).toBe(
      "running",
    );
  });

  test("asking for the status a machine already has succeeds", async () => {
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {});
    // boxd refuses resume on a running machine with a conflict.
    const row = await t.action(api.machines.resume, { machineId });
    expect(row.status).toBe("running");
    expect(cloud.calls.slice(-3)).toEqual([
      `resume ${machineId}`,
      `get ${machineId}`,
      `waitUntilReady ${machineId}`,
    ]);
  });

  test("a real conflict fails and lands on the row", async () => {
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {});
    await t.action(api.machines.stop, { machineId });
    const data = await rejection(t.action(api.machines.pause, { machineId }));
    expect(data.code).toBe("CONFLICT");
    const row = await t.query(api.machines.get, { machineId });
    expect(row?.status).toBe("stopped");
    expect(row?.lastError).toContain("VM is stopped");

    // The next success clears it.
    await t.action(api.machines.start, { machineId });
    expect(
      (await t.query(api.machines.get, { machineId }))?.lastError,
    ).toBeUndefined();
  });

  test("an unexpected conflict is not swallowed", async () => {
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {});
    cloud.failures.set("stop", conflict("VM is migrating"));
    const data = await rejection(t.action(api.machines.stop, { machineId }));
    expect(data).toEqual({ code: "CONFLICT", message: "VM is migrating" });
  });
});

describe("refresh and destroy", () => {
  test("refresh marks a machine boxd no longer has as destroyed", async () => {
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {});
    cloud.machines.delete(machineId);
    const data = await rejection(t.action(api.machines.refresh, { machineId }));
    expect(data.code).toBe("NOT_FOUND");
    expect((await t.query(api.machines.get, { machineId }))?.status).toBe(
      "destroyed",
    );
  });

  test("destroy keeps the row, and is idempotent", async () => {
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {});
    const row = await t.action(api.machines.destroy, { machineId });
    expect(row.status).toBe("destroyed");
    expect(cloud.machines.has(machineId)).toBe(false);
    // Gone on boxd already: still a success.
    expect((await t.action(api.machines.destroy, { machineId })).status).toBe(
      "destroyed",
    );
    expect(await t.query(api.machines.list, {})).toHaveLength(1);
  });
});

describe("expose", () => {
  test("points the default URL at a port", async () => {
    const t = initConvexTest();
    const { machineId, name } = await t.action(api.machines.create, {});
    const result = await t.action(api.machines.expose, {
      machineId,
      port: 8080,
    });
    expect(result).toEqual({ url: `https://${name}.boxd.test`, port: 8080 });
    expect(cloud.lastParams).toEqual({ port: 8080 });
  });

  test("adds a named route beside it", async () => {
    const t = initConvexTest();
    const { machineId, name } = await t.action(api.machines.create, {});
    const result = await t.action(api.machines.expose, {
      machineId,
      port: 3000,
      name: "api",
    });
    expect(result).toEqual({
      url: `https://api.${name}.boxd.test`,
      port: 3000,
    });
  });

  test("a machine with no URL fails before a route is created", async () => {
    const t = initConvexTest();
    await t.mutation(internal.machines.upsert, {
      machineId: "vm-bare",
      name: "bare",
      status: "running",
    });
    cloud.add({ id: "vm-bare", name: "" });
    const data = await rejection(
      t.action(api.machines.expose, {
        machineId: "vm-bare",
        port: 80,
        name: "api",
      }),
    );
    expect(data.code).toBe("BOXD_ERROR");
    expect(cloud.calls).not.toContain("createProxy vm-bare");
  });

  test("rejects a bad port or name before calling boxd", async () => {
    const t = initConvexTest();
    const { machineId } = await t.action(api.machines.create, {});
    cloud.calls = [];
    for (const args of [
      { machineId, port: 0 },
      { machineId, port: 70_000 },
      { machineId, port: 80.5 },
      { machineId, port: 80, name: "Bad_Name" },
      { machineId, port: 80, name: "-api" },
    ]) {
      const data = await rejection(t.action(api.machines.expose, args));
      expect(data.code).toBe("INVALID_ARGUMENT");
    }
    expect(cloud.calls).toEqual([]);
  });
});

describe("bookkeeping", () => {
  test("a late write never revives a destroyed machine", async () => {
    const t = initConvexTest();
    const fields = { machineId: "vm-x", name: "x", status: "running" };
    await t.mutation(internal.machines.upsert, fields);
    await t.mutation(internal.machines.markDestroyed, { machineId: "vm-x" });
    // An action that read the machine before the destroy writes afterwards.
    const row = await t.mutation(internal.machines.upsert, fields);
    expect(row.status).toBe("destroyed");
    expect(
      (await t.query(api.machines.get, { machineId: "vm-x" }))?.status,
    ).toBe("destroyed");
  });

  test("upsert never changes the owner or the fork source", async () => {
    const t = initConvexTest();
    const fields = { machineId: "vm-x", name: "x", status: "running" };
    await t.mutation(internal.machines.upsert, {
      ...fields,
      ownerId: "user-1",
      forkedFrom: "vm-a",
    });
    const row = await t.mutation(internal.machines.upsert, {
      ...fields,
      status: "stopped",
      ownerId: "user-2",
      forkedFrom: "vm-b",
    });
    expect(row).toMatchObject({
      status: "stopped",
      ownerId: "user-1",
      forkedFrom: "vm-a",
    });
  });

  test("list clamps its limit", async () => {
    const t = initConvexTest();
    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.machines.upsert, {
        machineId: `vm-${i}`,
        name: `m${i}`,
        status: "running",
      });
    }
    expect(await t.query(api.machines.list, { limit: 0 })).toHaveLength(1);
    expect(await t.query(api.machines.list, { limit: 2 })).toHaveLength(2);
    expect(
      await t.query(api.machines.list, { limit: Number.NaN }),
    ).toHaveLength(3);
  });
});
