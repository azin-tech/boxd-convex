/**
 * The public demo: every visitor gets up to two real boxd machines for ten
 * minutes. `example.ts` wraps the whole API; this file wraps the part the
 * demo page uses, behind the limits a page open to the internet needs.
 *
 * - Visitors sign in anonymously (auth.ts), and own what they create.
 * - A slot is taken before boxd is called, so the caps hold under load.
 * - Creates and commands are rate limited, per visitor and overall.
 * - A cron destroys every machine when its ten minutes are up.
 */
import { Boxd, isBoxdError } from "@boxd-sh/convex";
import { getAuthUserId } from "@convex-dev/auth/server";
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server.js";

const boxd = new Boxd(components.boxd);

export const LIMITS = {
  /** How long a demo machine lives. */
  lifetimeMs: 10 * MINUTE,
  /** Live machines across all visitors. */
  machines: 10,
  /** Live machines per visitor: one, and a fork of it. */
  perVisitor: 2,
  commandTimeoutMs: 30_000,
  commandLength: 2_000,
};

const rateLimiter = new RateLimiter(components.rateLimiter, {
  createPerVisitor: { kind: "fixed window", rate: 6, period: HOUR },
  createOverall: { kind: "fixed window", rate: 60, period: HOUR },
  command: { kind: "token bucket", rate: 20, period: MINUTE },
});

/** Errors carry `{ code, message }`, like the component's own. */
function demoError(code: string, message: string) {
  return new ConvexError({ code, message });
}

function minutes(ms: number) {
  const n = Math.max(1, Math.ceil(ms / MINUTE));
  return n === 1 ? "a minute" : `${n} minutes`;
}

async function visitor(ctx: ActionCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw demoError("UNAUTHENTICATED", "Reload the page to sign in");
  return userId;
}

// ---- Reads ------------------------------------------------------------------

/** How many demo machines are running, for the page's counter. */
export const usage = query({
  args: {},
  handler: async (ctx) => {
    const slots = await ctx.db.query("demoSlots").take(LIMITS.machines);
    return {
      running: slots.length,
      capacity: LIMITS.machines,
      lifetimeMs: LIMITS.lifetimeMs,
    };
  },
});

/**
 * The visitor's machines, oldest first, with when each is destroyed.
 * `machine` is null while boxd is still creating it.
 */
export const machines = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await getAuthUserId(ctx);
    if (!ownerId) return [];
    const slots = await ctx.db
      .query("demoSlots")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    const rows = await Promise.all(
      slots.map(async (slot) => ({
        slotId: slot._id,
        expiresAt: slot.expiresAt,
        machine: slot.machineId
          ? await boxd.get(ctx, { machineId: slot.machineId, ownerId })
          : null,
      })),
    );
    return rows.filter((row) => row.machine?.status !== "destroyed");
  },
});

/** A machine's commands, newest first. */
export const executions = query({
  args: { machineId: v.string() },
  handler: async (ctx, { machineId }) => {
    const ownerId = await getAuthUserId(ctx);
    if (!ownerId) return [];
    return await boxd.listExecutions(ctx, { machineId, ownerId, limit: 25 });
  },
});

// ---- Machines ---------------------------------------------------------------

export const createMachine = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const ownerId = await visitor(ctx);
    const slotId = await ctx.runMutation(internal.demo.reserve, { ownerId });
    return await fillSlot(ctx, slotId, () =>
      boxd.create(ctx, {
        ownerId,
        vcpu: 1,
        autoSuspendSeconds: 120,
        // boxd's own timer, in case the sweep is ever late.
        autoDestroySeconds: LIMITS.lifetimeMs / 1000,
        // The page runs whatever a visitor types, so the machine can't reach
        // the boxd API, other machines, or the org's integrations.
        isolated: true,
      }),
    );
  },
});

export const forkMachine = action({
  args: { machineId: v.string() },
  handler: async (ctx, { machineId }): Promise<string> => {
    const ownerId = await visitor(ctx);
    const slotId = await ctx.runMutation(internal.demo.reserve, { ownerId });
    return await fillSlot(ctx, slotId, () =>
      boxd.fork(ctx, { machineId, ownerId }),
    );
  },
});

/** Put the new machine in its slot, or free the slot if there is none. */
async function fillSlot(
  ctx: ActionCtx,
  slotId: Id<"demoSlots">,
  make: () => Promise<{ machineId: string }>,
): Promise<string> {
  try {
    const { machineId } = await make();
    await ctx.runMutation(internal.demo.attach, { slotId, machineId });
    return machineId;
  } catch (error) {
    // A machine that exists but never became ready still bills: keep it in
    // the slot, so the sweep destroys it.
    const data = error instanceof ConvexError ? error.data : undefined;
    const machineId =
      typeof data?.machineId === "string" ? data.machineId : undefined;
    if (machineId) {
      await ctx.runMutation(internal.demo.attach, { slotId, machineId });
    } else {
      await ctx.runMutation(internal.demo.release, { slotId });
    }
    throw error;
  }
}

const transition = v.union(
  v.literal("pause"),
  v.literal("resume"),
  v.literal("hibernate"),
  v.literal("wake"),
);

export const setState = action({
  args: { machineId: v.string(), to: transition },
  handler: async (ctx, { machineId, to }) => {
    const ref = { machineId, ownerId: await visitor(ctx) };
    switch (to) {
      case "pause":
        return void (await boxd.pause(ctx, ref));
      case "resume":
        return void (await boxd.resume(ctx, ref));
      case "hibernate":
        return void (await boxd.hibernate(ctx, ref));
      case "wake":
        return void (await boxd.wake(ctx, ref));
    }
  },
});

export const destroyMachine = action({
  args: { machineId: v.string() },
  handler: async (ctx, { machineId }) => {
    await boxd.destroy(ctx, { machineId, ownerId: await visitor(ctx) });
    await ctx.runMutation(internal.demo.releaseMachine, { machineId });
  },
});

/**
 * Re-read a machine's status into its row. The page polls this so the badge
 * tracks changes boxd makes on its own, like auto-suspend after idle. A
 * machine the sweep already destroyed is fine; the row is gone with it.
 */
export const refreshMachine = action({
  args: { machineId: v.string() },
  handler: async (ctx, { machineId }) => {
    const ownerId = await visitor(ctx);
    try {
      await boxd.refresh(ctx, { machineId, ownerId });
    } catch (error) {
      if (!isBoxdError(error, "NOT_FOUND")) throw error;
    }
  },
});

// ---- Commands ---------------------------------------------------------------

/** Runs a command. Its status and output arrive through `executions`. */
export const runCommand = action({
  args: { machineId: v.string(), command: v.string() },
  handler: async (ctx, { machineId, command }) => {
    const ownerId = await visitor(ctx);
    if (!command.trim()) {
      throw demoError("INVALID_ARGUMENT", "Type a command to run");
    }
    if (command.length > LIMITS.commandLength) {
      throw demoError(
        "INVALID_ARGUMENT",
        `Commands are limited to ${LIMITS.commandLength} characters in the demo`,
      );
    }
    const limit = await rateLimiter.limit(ctx, "command", { key: ownerId });
    if (!limit.ok) {
      throw demoError(
        "RATE_LIMITED",
        `That's a lot of commands. Try again in ${Math.ceil(limit.retryAfter / 1000)}s`,
      );
    }
    await boxd.exec(ctx, {
      machineId,
      ownerId,
      command,
      timeoutMs: LIMITS.commandTimeoutMs,
    });
    // A command auto-wakes a paused or hibernated machine, so re-read its
    // status into the row. Best effort: the command already ran and recorded.
    try {
      await boxd.refresh(ctx, { machineId, ownerId });
    } catch {
      // Leave the status as it was; the next refresh will correct it.
    }
  },
});

// ---- Slots ------------------------------------------------------------------

export const reserve = internalMutation({
  args: { ownerId: v.string() },
  handler: async (ctx, { ownerId }) => {
    const mine = await ctx.db
      .query("demoSlots")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .take(LIMITS.perVisitor);
    if (mine.length >= LIMITS.perVisitor) {
      throw demoError(
        "RATE_LIMITED",
        `The demo runs ${LIMITS.perVisitor} machines per visitor. Destroy one to make another`,
      );
    }
    const all = await ctx.db.query("demoSlots").take(LIMITS.machines);
    if (all.length >= LIMITS.machines) {
      throw demoError(
        "RATE_LIMITED",
        "Every demo machine is in use. One frees up within ten minutes",
      );
    }
    for (const [name, key] of [
      ["createPerVisitor", ownerId],
      ["createOverall", undefined],
    ] as const) {
      const limit = await rateLimiter.limit(ctx, name, { key });
      if (!limit.ok) {
        throw demoError(
          "RATE_LIMITED",
          `The demo has made enough machines for now. Try again in ${minutes(limit.retryAfter)}`,
        );
      }
    }
    return await ctx.db.insert("demoSlots", {
      ownerId,
      expiresAt: Date.now() + LIMITS.lifetimeMs,
    });
  },
});

export const attach = internalMutation({
  args: { slotId: v.id("demoSlots"), machineId: v.string() },
  handler: async (ctx, { slotId, machineId }) => {
    await ctx.db.patch("demoSlots", slotId, { machineId });
  },
});

export const release = internalMutation({
  args: { slotId: v.id("demoSlots") },
  handler: async (ctx, { slotId }) => {
    if (await ctx.db.get("demoSlots", slotId))
      await ctx.db.delete("demoSlots", slotId);
  },
});

export const releaseMachine = internalMutation({
  args: { machineId: v.string() },
  handler: async (ctx, { machineId }) => {
    const slot = await ctx.db
      .query("demoSlots")
      .withIndex("by_machine", (q) => q.eq("machineId", machineId))
      .unique();
    if (slot) await ctx.db.delete("demoSlots", slot._id);
  },
});

export const expiredSlots = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) =>
    await ctx.db
      .query("demoSlots")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", now))
      .take(50),
});

/** Destroys machines whose time is up, and frees their slots. */
export const sweep = internalAction({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.runQuery(internal.demo.expiredSlots, {
      now: Date.now(),
    });
    for (const slot of expired) {
      if (slot.machineId) {
        try {
          await boxd.destroy(ctx, {
            machineId: slot.machineId,
            ownerId: slot.ownerId,
          });
        } catch (error) {
          // Already gone is fine. Anything else keeps the slot for the next
          // sweep, so a machine is never forgotten while it still bills.
          if (!isBoxdError(error, "NOT_FOUND")) {
            console.error(`sweep: destroy ${slot.machineId} failed`, error);
            continue;
          }
        }
      }
      await ctx.runMutation(internal.demo.release, { slotId: slot._id });
    }
  },
});
