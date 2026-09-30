/**
 * Machines: reactive queries over the `machines` table, the bookkeeping
 * mutations behind them, and the lifecycle actions that call boxd and write
 * back what they observed.
 */

import type { Boxd, Machine } from "@boxd-sh/sdk/web";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server.js";
import { withBoxd } from "./boxd.js";
import {
  boxdError,
  errorMessage,
  isNotFound,
  toConvexError,
} from "./errors.js";
import {
  DEFAULT_READY_TIMEOUT_MS,
  MAX_READY_TIMEOUT_MS,
  clampLimit,
} from "./limits.js";
import {
  machineDoc,
  observed,
  recordFailure,
  requireMachine,
  type MachineDoc,
} from "./records.js";
import {
  boundedTimeout,
  requireNonEmpty,
  requirePort,
  requireSubdomainLabel,
} from "./validate.js";

// ---- Reactive reads -------------------------------------------------------

export const get = query({
  args: { machineId: v.string(), ownerId: v.optional(v.string()) },
  returns: v.union(v.null(), machineDoc),
  handler: async (ctx, { machineId, ownerId }) => {
    const row = await ctx.db
      .query("machines")
      .withIndex("by_machine_id", (q) => q.eq("machineId", machineId))
      .unique();
    return row && row.ownerId === ownerId ? row : null;
  },
});

/** The owner's machines, newest first. Destroyed machines stay listed. */
export const list = query({
  args: { ownerId: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(machineDoc),
  handler: async (ctx, { ownerId, limit }) => {
    return await ctx.db
      .query("machines")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(clampLimit(limit));
  },
});

// ---- Bookkeeping ----------------------------------------------------------

export const record = internalQuery({
  args: { machineId: v.string() },
  returns: v.union(v.null(), machineDoc),
  handler: async (ctx, { machineId }) => {
    return await ctx.db
      .query("machines")
      .withIndex("by_machine_id", (q) => q.eq("machineId", machineId))
      .unique();
  },
});

/**
 * Insert a machine's row or refresh it with what boxd reported. `ownerId`
 * and `forkedFrom` are set once, on insert. A success clears `lastError`.
 * "destroyed" is final: an action that read the machine before a concurrent
 * destroy finished must not bring the row back to life.
 */
export const upsert = internalMutation({
  args: {
    machineId: v.string(),
    name: v.string(),
    status: v.string(),
    image: v.optional(v.string()),
    url: v.optional(v.string()),
    vcpu: v.optional(v.number()),
    memoryBytes: v.optional(v.number()),
    ownerId: v.optional(v.string()),
    forkedFrom: v.optional(v.string()),
  },
  returns: machineDoc,
  handler: async (ctx, { ownerId, forkedFrom, ...fields }) => {
    const row = await ctx.db
      .query("machines")
      .withIndex("by_machine_id", (q) => q.eq("machineId", fields.machineId))
      .unique();
    const updatedAt = Date.now();
    if (row?.status === "destroyed") return row;
    if (row) {
      await ctx.db.patch("machines", row._id, {
        ...fields,
        lastError: undefined,
        updatedAt,
      });
      return { ...row, ...fields, lastError: undefined, updatedAt };
    }
    const doc = { ...fields, ownerId, forkedFrom, updatedAt };
    const id = await ctx.db.insert("machines", doc);
    return (await ctx.db.get("machines", id))!;
  },
});

export const setError = internalMutation({
  args: { machineId: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { machineId, error }) => {
    const row = await ctx.db
      .query("machines")
      .withIndex("by_machine_id", (q) => q.eq("machineId", machineId))
      .unique();
    if (row) {
      await ctx.db.patch("machines", row._id, {
        lastError: error,
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

/** Keep the row, and with it the execution history, as a record. */
export const markDestroyed = internalMutation({
  args: { machineId: v.string() },
  returns: v.union(v.null(), machineDoc),
  handler: async (ctx, { machineId }) => {
    const row = await ctx.db
      .query("machines")
      .withIndex("by_machine_id", (q) => q.eq("machineId", machineId))
      .unique();
    if (!row) return null;
    const patch = {
      status: "destroyed",
      lastError: undefined,
      updatedAt: Date.now(),
    };
    await ctx.db.patch("machines", row._id, patch);
    return { ...row, ...patch };
  },
});

// ---- Actions --------------------------------------------------------------

const target = { machineId: v.string(), ownerId: v.optional(v.string()) };

const readiness = {
  /** Wait until the machine accepts an exec. Default true. */
  waitUntilReady: v.optional(v.boolean()),
  /** How long to wait, in ms. Default 120s, capped at 480s. */
  readyTimeoutMs: v.optional(v.number()),
};

function readyTimeout(args: {
  waitUntilReady?: boolean;
  readyTimeoutMs?: number;
}): number | undefined {
  if (args.waitUntilReady === false) return undefined;
  return boundedTimeout(
    args.readyTimeoutMs,
    DEFAULT_READY_TIMEOUT_MS,
    MAX_READY_TIMEOUT_MS,
    "readyTimeoutMs",
  );
}

/**
 * Run a boxd operation that ends in a fresh `Machine`, and store it. A
 * failure lands on the row; a machine boxd no longer knows is marked
 * destroyed.
 */
async function settle(
  ctx: ActionCtx,
  machineId: string,
  operation: (boxd: Boxd) => Promise<Machine>,
): Promise<MachineDoc> {
  let machine: Machine;
  try {
    machine = await withBoxd(ctx, operation);
  } catch (error) {
    if (isNotFound(error)) {
      await ctx.runMutation(internal.machines.markDestroyed, { machineId });
      throw error;
    }
    return await recordFailure(ctx, machineId, error);
  }
  return await ctx.runMutation(internal.machines.upsert, observed(machine));
}

/**
 * Store a machine boxd just created. If the row can't be written, destroy
 * the machine: a machine no row tracks would run, and bill, unseen.
 */
async function adopt(
  ctx: ActionCtx,
  machine: Machine,
  extra: { ownerId?: string; forkedFrom?: string },
): Promise<MachineDoc> {
  try {
    return await ctx.runMutation(internal.machines.upsert, {
      ...observed(machine),
      ...extra,
    });
  } catch (error) {
    await withBoxd(ctx, (boxd) => boxd.machines.delete(machine.id)).catch(
      (cleanup: unknown) =>
        console.error(
          `boxd: could not destroy untracked machine ${machine.id}: ${errorMessage(cleanup)}`,
        ),
    );
    throw error;
  }
}

/**
 * Wait for a machine `create` or `fork` just made. On failure the machine
 * still exists and bills, so the error carries its `machineId`: the caller
 * can destroy it, or wait longer, instead of creating another one.
 */
async function ready(
  ctx: ActionCtx,
  row: MachineDoc,
  timeout: number | undefined,
): Promise<MachineDoc> {
  if (timeout === undefined) return row;
  try {
    return await settle(ctx, row.machineId, (boxd) =>
      boxd.machines.waitUntilReady(row.machineId, { timeout }),
    );
  } catch (error) {
    const { data } = toConvexError(error);
    throw new ConvexError({ ...data, machineId: row.machineId });
  }
}

export const create = action({
  args: {
    ownerId: v.optional(v.string()),
    /** Unique in the key's org. Omit for a generated name. */
    name: v.optional(v.string()),
    /** OCI image. Omit for the boxd default image. */
    image: v.optional(v.string()),
    /** Environment variables for the machine. Not stored by the component. */
    env: v.optional(v.record(v.string(), v.string())),
    /** Size class: 1, 2 or 4 vCPU. The memory follows (4, 8 or 16 GiB). */
    vcpu: v.optional(v.number()),
    /** Size class by memory: "4G", "8G" or "16G". */
    memory: v.optional(v.string()),
    /** Idle seconds before boxd suspends the machine. 0 disables. */
    autoSuspendSeconds: v.optional(v.number()),
    /** Idle seconds before boxd destroys the machine. 0 disables. */
    autoDestroySeconds: v.optional(v.number()),
    /** Reachable only through explicit networks; no in-VM boxd CLI. */
    isolated: v.optional(v.boolean()),
    ...readiness,
  },
  returns: machineDoc,
  handler: async (ctx, args) => {
    const timeout = readyTimeout(args);
    if (args.name !== undefined) requireNonEmpty(args.name, "name");
    const machine = await withBoxd(ctx, (boxd) =>
      boxd.machines.create({
        name: args.name,
        image: args.image,
        env: args.env,
        isolated: args.isolated,
        config: {
          vcpu: args.vcpu,
          memory: args.memory,
          autoSuspendTimeout: args.autoSuspendSeconds,
          autoDestroyTimeout: args.autoDestroySeconds,
        },
      }),
    );
    const row = await adopt(ctx, machine, { ownerId: args.ownerId });
    return await ready(ctx, row, timeout);
  },
});

/**
 * Fork a running machine: a copy of its disk and memory, booted as a new
 * machine. The fork has the source's owner and records `forkedFrom`.
 */
export const fork = action({
  args: { ...target, name: v.optional(v.string()), ...readiness },
  returns: machineDoc,
  handler: async (ctx, args) => {
    const timeout = readyTimeout(args);
    if (args.name !== undefined) requireNonEmpty(args.name, "name");
    const source = await requireMachine(ctx, args.machineId, args.ownerId);
    let machine: Machine;
    try {
      machine = await withBoxd(ctx, (boxd) =>
        boxd.machines.fork(source.machineId, { name: args.name }),
      );
    } catch (error) {
      return await recordFailure(ctx, source.machineId, error);
    }
    const row = await adopt(ctx, machine, {
      ownerId: source.ownerId,
      forkedFrom: source.machineId,
    });
    return await ready(ctx, row, timeout);
  },
});

/** Re-read the machine from boxd into its row. */
export const refresh = action({
  args: target,
  returns: machineDoc,
  handler: async (ctx, { machineId, ownerId }) => {
    await requireMachine(ctx, machineId, ownerId);
    return await settle(ctx, machineId, (boxd) => boxd.machines.get(machineId));
  },
});

type Transition = "start" | "stop" | "pause" | "resume" | "hibernate" | "wake";

/** The status each transition ends in. */
const TARGET: Record<Transition, string> = {
  start: "running",
  resume: "running",
  wake: "running",
  stop: "stopped",
  pause: "suspended",
  hibernate: "hibernated",
};

/** How long a sleeping transition polls for its target status. */
const SETTLE_TIMEOUT_MS = 60_000;
const SETTLE_POLL_MS = 500;

/**
 * Ask boxd for `verb`. A machine already in the target status is not an
 * error: boxd refuses `resume` on a running machine with a conflict, but
 * the caller's goal is reached.
 */
async function request(
  boxd: Boxd,
  machineId: string,
  verb: Transition,
): Promise<void> {
  try {
    await boxd.machines[verb](machineId);
  } catch (error) {
    if (toConvexError(error).data.code !== "CONFLICT") throw error;
    const machine = await boxd.machines.get(machineId);
    if (machine.status !== TARGET[verb]) throw error;
  }
}

/**
 * Poll until the machine reports `status`, or return the last observed
 * machine after `timeoutMs`: a transition still in progress is not a
 * failure, and the row shows exactly what boxd reported.
 */
async function reach(
  boxd: Boxd,
  machineId: string,
  status: string,
  timeoutMs: number,
): Promise<Machine> {
  const deadline = Date.now() + timeoutMs;
  let machine = await boxd.machines.get(machineId);
  while (machine.status !== status && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    machine = await boxd.machines.get(machineId);
  }
  return machine;
}

/**
 * A transition that ends with the machine asleep or off. Returns once boxd
 * reports the target status, or after 60 seconds with the status it reports
 * then.
 */
function sleeping(verb: Transition) {
  return action({
    args: target,
    returns: machineDoc,
    handler: async (ctx, { machineId, ownerId }) => {
      await requireMachine(ctx, machineId, ownerId);
      return await settle(ctx, machineId, async (boxd) => {
        await request(boxd, machineId, verb);
        return await reach(boxd, machineId, TARGET[verb], SETTLE_TIMEOUT_MS);
      });
    },
  });
}

/**
 * A transition that ends with the machine running. By default it returns
 * once the machine accepts an exec.
 */
function waking(verb: Transition) {
  return action({
    args: { ...target, ...readiness },
    returns: machineDoc,
    handler: async (ctx, args) => {
      const timeout = readyTimeout(args);
      await requireMachine(ctx, args.machineId, args.ownerId);
      return await settle(ctx, args.machineId, async (boxd) => {
        await request(boxd, args.machineId, verb);
        return timeout === undefined
          ? await boxd.machines.get(args.machineId)
          : await boxd.machines.waitUntilReady(args.machineId, { timeout });
      });
    },
  });
}

/** Boot a stopped machine (cold boot: disk kept, memory not). */
export const start = waking("start");
/** Shut the machine down. The disk is kept. */
export const stop = sleeping("stop");
/** Suspend to RAM: frozen in place, resumes in milliseconds. */
export const pause = sleeping("pause");
/** Resume a paused machine. */
export const resume = waking("resume");
/** Suspend to disk: frees the host's memory, `wake` restores it. */
export const hibernate = sleeping("hibernate");
/** Restore a hibernated machine, memory included. */
export const wake = waking("wake");

/** Destroy the machine. Its row stays, with status "destroyed". */
export const destroy = action({
  args: target,
  returns: machineDoc,
  handler: async (ctx, { machineId, ownerId }): Promise<MachineDoc> => {
    await requireMachine(ctx, machineId, ownerId);
    try {
      await withBoxd(ctx, (boxd) => boxd.machines.delete(machineId));
    } catch (error) {
      // Already gone on boxd: the goal is reached.
      if (!isNotFound(error)) return await recordFailure(ctx, machineId, error);
    }
    const row: MachineDoc | null = await ctx.runMutation(
      internal.machines.markDestroyed,
      { machineId },
    );
    return row!;
  },
});

/**
 * Route public HTTPS to a port inside the machine. Without `name`, this
 * points the machine's default URL (`https://<machine>.<zone>`) at `port`.
 * With `name`, it adds `https://<name>.<machine>.<zone>` beside it.
 */
export const expose = action({
  args: { ...target, port: v.number(), name: v.optional(v.string()) },
  returns: v.object({ url: v.string(), port: v.number() }),
  handler: async (ctx, { machineId, ownerId, port, name }) => {
    requirePort(port);
    if (name !== undefined) requireSubdomainLabel(name);
    const row = await requireMachine(ctx, machineId, ownerId);
    try {
      return await withBoxd(ctx, async (boxd) => {
        const base = row.url ?? (await boxd.machines.get(machineId)).access.url;
        if (!base) {
          throw boxdError(
            "BOXD_ERROR",
            `machine ${machineId} has no HTTPS URL to route`,
          );
        }
        if (name === undefined) {
          await boxd.machines.proxies.setPort(machineId, port);
          return { url: base, port };
        }
        const created = await boxd.machines.proxies.create(
          machineId,
          name,
          port,
        );
        const host = new URL(base).host;
        return { url: `https://${created.name}.${host}`, port: created.port };
      });
    } catch (error) {
      return await recordFailure(ctx, machineId, error);
    }
  },
});
