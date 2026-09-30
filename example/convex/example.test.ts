/// <reference types="vite/client" />
import { isBoxdError } from "@boxd-sh/convex";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cloud,
  resetCloud,
  stubExchange,
} from "../../src/component/setup.test.js";
import { api } from "./_generated/api.js";
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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const alice = { subject: "alice" };
const bob = { subject: "bob" };

describe("example app", () => {
  test("a signed-in user drives a machine end to end", async () => {
    const t = initConvexTest().withIdentity(alice);
    const machine = await t.action(api.example.createMachine, { name: "lab" });
    expect(machine).toMatchObject({ name: "lab", ownerId: "alice" });
    expect(cloud.lastParams).toMatchObject({
      timeout: expect.any(Number),
    });

    cloud.execResult = { stdout: "ok\n", stderr: "", exitCode: 0 };
    const run = await t.action(api.example.runCommand, {
      machineId: machine.machineId,
      command: "echo ok",
    });
    expect(run.stdout).toBe("ok\n");

    await t.action(api.example.writeFile, {
      machineId: machine.machineId,
      path: "/tmp/x",
      content: "x",
    });
    expect(
      await t.action(api.example.readFile, {
        machineId: machine.machineId,
        path: "/tmp/x",
      }),
    ).toBe("x");

    const [execution] = await t.query(api.example.executions, {
      machineId: machine.machineId,
    });
    expect(
      await t.query(api.example.execution, {
        executionId: execution._id,
      }),
    ).toMatchObject({ status: "completed", stdout: "ok\n" });
    expect(await t.query(api.example.myMachines, {})).toHaveLength(1);

    const destroyed = await t.action(api.example.destroyMachine, {
      machineId: machine.machineId,
    });
    expect(destroyed.status).toBe("destroyed");
  });

  test("one user can't see or touch another user's machine", async () => {
    const base = initConvexTest();
    const machine = await base
      .withIdentity(alice)
      .action(api.example.createMachine, {});
    const asBob = base.withIdentity(bob);

    expect(await asBob.query(api.example.myMachines, {})).toEqual([]);
    expect(
      await asBob.query(api.example.machine, { machineId: machine.machineId }),
    ).toBeNull();
    expect(
      await asBob.action(api.example.refreshOrNull, {
        machineId: machine.machineId,
      }),
    ).toBeNull();
    const error = await asBob
      .action(api.example.destroyMachine, { machineId: machine.machineId })
      .catch((e: unknown) => e);
    // The coded error crosses the component boundary intact.
    expect(isBoxdError(error, "NOT_FOUND")).toBe(true);
    expect(cloud.machines.get(machine.machineId)?.status).toBe("running");
  });

  test("signed-out callers are refused before the component runs", async () => {
    const t = initConvexTest();
    await expect(t.action(api.example.createMachine, {})).rejects.toThrow(
      "Sign in",
    );
    expect(cloud.calls).toEqual([]);
  });
});
