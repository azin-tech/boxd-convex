/// <reference types="vite/client" />
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { WATCHDOG_GRACE_MS } from "./executions.js";
import { MAX_STORED_OUTPUT } from "./limits.js";
import {
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
  stubExchange();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function machine(t: ReturnType<typeof initConvexTest>, ownerId?: string) {
  return (await t.action(api.machines.create, { ownerId })).machineId;
}

describe("exec.run", () => {
  test("returns the output and records a completed execution", async () => {
    const t = initConvexTest();
    const machineId = await machine(t, "user-1");
    cloud.execResult = { stdout: "hello\n", stderr: "warn\n", exitCode: 0 };

    const result = await t.action(api.exec.run, {
      machineId,
      ownerId: "user-1",
      command: "echo hello",
      cwd: "/workspace",
      env: { TOKEN: "t0ken" },
    });
    expect(result).toMatchObject({
      exitCode: 0,
      success: true,
      stdout: "hello\n",
      stderr: "warn\n",
    });
    expect(cloud.lastParams).toEqual({
      command: "echo hello",
      cwd: "/workspace",
      env: { TOKEN: "t0ken" },
      timeout: 540_000,
    });

    const row = await t.query(api.executions.get, {
      executionId: result.executionId,
      ownerId: "user-1",
    });
    expect(row).toMatchObject({
      machineId,
      ownerId: "user-1",
      command: "echo hello",
      cwd: "/workspace",
      status: "completed",
      exitCode: 0,
      stdout: "hello\n",
      stderr: "warn\n",
    });
    expect(row?.finishedAt).toBeGreaterThanOrEqual(row!.startedAt);
    // The per-command environment is never stored.
    expect(JSON.stringify(row)).not.toContain("t0ken");
  });

  test("a non-zero exit still completes: the command ran", async () => {
    const t = initConvexTest();
    const machineId = await machine(t);
    cloud.execResult = { stdout: "", stderr: "nope\n", exitCode: 2 };
    const result = await t.action(api.exec.run, {
      machineId,
      command: "false",
    });
    expect(result).toMatchObject({ exitCode: 2, success: false });
    const [row] = await t.query(api.executions.list, { machineId });
    expect(row).toMatchObject({ status: "completed", exitCode: 2 });
  });

  test("shows an argv command the way a shell would read it", async () => {
    const t = initConvexTest();
    const machineId = await machine(t);
    await t.action(api.exec.run, {
      machineId,
      command: ["sh", "-c", "echo it's here", "--flag=a/b"],
    });
    const [row] = await t.query(api.executions.list, { machineId });
    expect(row.command).toBe(`sh -c 'echo it'"'"'s here' --flag=a/b`);
    // The argv itself goes to boxd untouched, to be quoted by the SDK.
    expect(cloud.lastParams.command).toEqual([
      "sh",
      "-c",
      "echo it's here",
      "--flag=a/b",
    ]);
  });

  test("stores a bounded slice of large output and returns it all", async () => {
    const t = initConvexTest();
    const machineId = await machine(t);
    const big = "x".repeat(MAX_STORED_OUTPUT * 2);
    cloud.execResult = { stdout: big, stderr: "", exitCode: 0 };
    const result = await t.action(api.exec.run, { machineId, command: "yes" });
    expect(result.stdout).toBe(big);
    const [row] = await t.query(api.executions.list, { machineId });
    expect(row.stdout!.length).toBe(MAX_STORED_OUTPUT);
    expect(row.stdout!.endsWith("…[truncated]")).toBe(true);
  });

  test("records a failed execution and rethrows a coded error", async () => {
    const t = initConvexTest();
    const machineId = await machine(t);
    cloud.failures.set(
      "exec",
      Object.assign(new Error("exec timed out after 1000ms"), {
        name: "BoxdError",
      }),
    );
    const error = await t
      .action(api.exec.run, { machineId, command: "sleep 5", timeoutMs: 1000 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConvexError);
    expect((error as ConvexError<{ code: string }>).data.code).toBe("TIMEOUT");
    const [row] = await t.query(api.executions.list, { machineId });
    expect(row).toMatchObject({
      status: "failed",
      error: "exec timed out after 1000ms",
    });
  });

  test("caps the timeout below the action ceiling", async () => {
    const t = initConvexTest();
    const machineId = await machine(t);
    await t.action(api.exec.run, {
      machineId,
      command: "true",
      timeoutMs: 3_600_000,
    });
    expect(cloud.lastParams.timeout).toBe(570_000);
  });

  test("rejects bad arguments before recording anything", async () => {
    const t = initConvexTest();
    const machineId = await machine(t);
    for (const args of [
      { command: "true", timeoutMs: 0 },
      { command: "true", timeoutMs: Number.POSITIVE_INFINITY },
      { command: "true", cwd: "relative/dir" },
      { command: "   " },
      { command: [] },
    ]) {
      const error = await t
        .action(api.exec.run, { machineId, ...args })
        .catch((e: unknown) => e);
      expect((error as ConvexError<{ code: string }>).data.code).toBe(
        "INVALID_ARGUMENT",
      );
    }
    expect(await t.query(api.executions.list, { machineId })).toEqual([]);
  });
});

describe("watchdog", () => {
  test("fails a row whose action died, after the timeout and a grace", async () => {
    vi.useFakeTimers();
    try {
      const t = initConvexTest();
      const machineId = await machine(t);
      // What `run` records before it calls boxd; the action then "dies".
      const executionId = await t.mutation(internal.executions.begin, {
        machineId,
        command: "yes > /dev/null",
        timeoutMs: 1_000,
      });
      vi.advanceTimersByTime(1_000 + WATCHDOG_GRACE_MS);
      await t.finishInProgressScheduledFunctions();
      const row = await t.query(api.executions.get, { executionId });
      expect(row).toMatchObject({
        status: "failed",
        error: expect.stringContaining("stopped before it recorded a result"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("leaves a finished row alone", async () => {
    const t = initConvexTest();
    const machineId = await machine(t);
    cloud.execResult = { stdout: "done", stderr: "", exitCode: 0 };
    const { executionId } = await t.action(api.exec.run, {
      machineId,
      command: "true",
    });
    await t.mutation(internal.executions.expire, { executionId });
    expect(await t.query(api.executions.get, { executionId })).toMatchObject({
      status: "completed",
      stdout: "done",
    });
  });
});

describe("a machine boxd no longer has", () => {
  test("exec marks its row destroyed", async () => {
    const t = initConvexTest();
    const machineId = await machine(t);
    cloud.machines.delete(machineId);
    const error = await t
      .action(api.exec.run, { machineId, command: "true" })
      .catch((e: unknown) => e);
    expect((error as ConvexError<{ code: string }>).data.code).toBe(
      "NOT_FOUND",
    );
    expect((await t.query(api.machines.get, { machineId }))?.status).toBe(
      "destroyed",
    );
  });
});

describe("executions", () => {
  test("list and get only show the owner's executions", async () => {
    const t = initConvexTest();
    const machineId = await machine(t, "user-1");
    const { executionId } = await t.action(api.exec.run, {
      machineId,
      ownerId: "user-1",
      command: "true",
    });
    expect(
      await t.query(api.executions.list, { machineId, ownerId: "user-2" }),
    ).toEqual([]);
    expect(
      await t.query(api.executions.get, { executionId, ownerId: "user-2" }),
    ).toBeNull();
    expect(
      await t.query(api.executions.list, { machineId, ownerId: "user-1" }),
    ).toHaveLength(1);
  });

  test("get treats a malformed id as not found", async () => {
    const t = initConvexTest();
    expect(
      await t.query(api.executions.get, { executionId: "not-an-id" }),
    ).toBeNull();
  });

  test("list is newest first", async () => {
    const t = initConvexTest();
    const machineId = await machine(t);
    for (const command of ["first", "second", "third"]) {
      await t.action(api.exec.run, { machineId, command });
    }
    const rows = await t.query(api.executions.list, { machineId, limit: 2 });
    expect(rows.map((r) => r.command)).toEqual(["third", "second"]);
  });
});
