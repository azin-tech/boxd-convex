/**
 * Execution records: reactive queries over the `executions` table, plus the
 * bookkeeping mutations `exec.run` writes through.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation, query } from "./_generated/server.js";
import { clampLimit } from "./limits.js";
import { executionDoc } from "./records.js";

/** A machine's executions, newest first. Empty for another owner's machine. */
export const list = query({
  args: {
    machineId: v.string(),
    ownerId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(executionDoc),
  handler: async (ctx, { machineId, ownerId, limit }) => {
    const machine = await ctx.db
      .query("machines")
      .withIndex("by_machine_id", (q) => q.eq("machineId", machineId))
      .unique();
    if (!machine || machine.ownerId !== ownerId) return [];
    return await ctx.db
      .query("executions")
      .withIndex("by_machine", (q) => q.eq("machineId", machineId))
      .order("desc")
      .take(clampLimit(limit));
  },
});

export const get = query({
  args: { executionId: v.string(), ownerId: v.optional(v.string()) },
  returns: v.union(v.null(), executionDoc),
  handler: async (ctx, { executionId, ownerId }) => {
    // Ids cross the component boundary as strings; a malformed one is simply
    // not found.
    const id = ctx.db.normalizeId("executions", executionId);
    if (!id) return null;
    const row = await ctx.db.get("executions", id);
    return row && row.ownerId === ownerId ? row : null;
  },
});

/** Grace after the command's own timeout before the watchdog steps in. */
export const WATCHDOG_GRACE_MS = 60_000;

/**
 * Record a starting execution, and schedule a watchdog for it. The action
 * marks the row finished itself, but an action that dies (a crash, a restart,
 * running out of memory) never reaches its `catch`, and the row would stay
 * "running" forever.
 */
export const begin = internalMutation({
  args: {
    machineId: v.string(),
    ownerId: v.optional(v.string()),
    command: v.string(),
    cwd: v.optional(v.string()),
    timeoutMs: v.number(),
  },
  returns: v.id("executions"),
  handler: async (ctx, { timeoutMs, ...fields }) => {
    const executionId = await ctx.db.insert("executions", {
      ...fields,
      status: "running",
      startedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      timeoutMs + WATCHDOG_GRACE_MS,
      internal.executions.expire,
      { executionId },
    );
    return executionId;
  },
});

/** Fail an execution whose action stopped before it could record a result. */
export const expire = internalMutation({
  args: { executionId: v.id("executions") },
  returns: v.null(),
  handler: async (ctx, { executionId }) => {
    const row = await ctx.db.get("executions", executionId);
    if (row?.status === "running") {
      await ctx.db.patch("executions", executionId, {
        status: "failed",
        error:
          "the action running this command stopped before it recorded a result",
        finishedAt: Date.now(),
      });
    }
    return null;
  },
});

export const finish = internalMutation({
  args: {
    executionId: v.id("executions"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    exitCode: v.optional(v.number()),
    stdout: v.optional(v.string()),
    stderr: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { executionId, ...result }) => {
    await ctx.db.patch("executions", executionId, {
      ...result,
      finishedAt: Date.now(),
    });
    return null;
  },
});
