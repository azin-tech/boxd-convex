import { Boxd, isBoxdError } from "@boxd-sh/convex";
import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api.js";
import {
  action,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server.js";

const boxd = new Boxd(components.boxd);

/**
 * The signed-in user's id. The component can't see `ctx.auth`, so every
 * wrapper derives the owner here and passes it on. Never accept an owner id
 * as a client argument.
 */
async function ownerId(ctx: QueryCtx | ActionCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to use a machine");
  return identity.subject;
}

/** A small machine that suspends after 5 idle minutes. */
export const createMachine = action({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) => {
    return await boxd.create(ctx, {
      ownerId: await ownerId(ctx),
      name,
      vcpu: 1,
      autoSuspendSeconds: 300,
    });
  },
});

export const forkMachine = action({
  args: { machineId: v.string() },
  handler: async (ctx, { machineId }) => {
    return await boxd.fork(ctx, { ownerId: await ownerId(ctx), machineId });
  },
});

export const runCommand = action({
  args: {
    machineId: v.string(),
    command: v.union(v.string(), v.array(v.string())),
    cwd: v.optional(v.string()),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await boxd.exec(ctx, { ...args, ownerId: await ownerId(ctx) });
  },
});

export const writeFile = action({
  args: { machineId: v.string(), path: v.string(), content: v.string() },
  handler: async (ctx, args) => {
    return await boxd.writeFile(ctx, { ...args, ownerId: await ownerId(ctx) });
  },
});

export const readFile = action({
  args: { machineId: v.string(), path: v.string() },
  handler: async (ctx, args) => {
    return await boxd.readFile(ctx, { ...args, ownerId: await ownerId(ctx) });
  },
});

/** The bytes of a file, e.g. an image the machine rendered. */
export const readFileBytes = action({
  args: { machineId: v.string(), path: v.string() },
  handler: async (ctx, args) => {
    return await boxd.readFileBytes(ctx, {
      ...args,
      ownerId: await ownerId(ctx),
    });
  },
});

export const listDir = action({
  args: { machineId: v.string(), path: v.string() },
  handler: async (ctx, args) => {
    return await boxd.listDir(ctx, { ...args, ownerId: await ownerId(ctx) });
  },
});

/** Put a server on the public internet, e.g. a dev server on port 3000. */
export const preview = action({
  args: {
    machineId: v.string(),
    port: v.number(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await boxd.expose(ctx, { ...args, ownerId: await ownerId(ctx) });
  },
});

const lifecycle = { machineId: v.string() };

export const pauseMachine = action({
  args: lifecycle,
  handler: async (ctx, { machineId }) =>
    await boxd.pause(ctx, { machineId, ownerId: await ownerId(ctx) }),
});

export const resumeMachine = action({
  args: lifecycle,
  handler: async (ctx, { machineId }) =>
    await boxd.resume(ctx, { machineId, ownerId: await ownerId(ctx) }),
});

export const hibernateMachine = action({
  args: lifecycle,
  handler: async (ctx, { machineId }) =>
    await boxd.hibernate(ctx, { machineId, ownerId: await ownerId(ctx) }),
});

export const wakeMachine = action({
  args: lifecycle,
  handler: async (ctx, { machineId }) =>
    await boxd.wake(ctx, { machineId, ownerId: await ownerId(ctx) }),
});

export const stopMachine = action({
  args: lifecycle,
  handler: async (ctx, { machineId }) =>
    await boxd.stop(ctx, { machineId, ownerId: await ownerId(ctx) }),
});

export const startMachine = action({
  args: lifecycle,
  handler: async (ctx, { machineId }) =>
    await boxd.start(ctx, { machineId, ownerId: await ownerId(ctx) }),
});

export const refreshMachine = action({
  args: lifecycle,
  handler: async (ctx, { machineId }) =>
    await boxd.refresh(ctx, { machineId, ownerId: await ownerId(ctx) }),
});

export const destroyMachine = action({
  args: lifecycle,
  handler: async (ctx, { machineId }) =>
    await boxd.destroy(ctx, { machineId, ownerId: await ownerId(ctx) }),
});

/**
 * Error codes are stable: branch on them instead of on messages. Here a
 * machine that doesn't exist (or isn't this user's) reads as `null`.
 */
export const refreshOrNull = action({
  args: lifecycle,
  handler: async (ctx, { machineId }) => {
    try {
      return await boxd.refresh(ctx, {
        machineId,
        ownerId: await ownerId(ctx),
      });
    } catch (error) {
      if (isBoxdError(error, "NOT_FOUND")) return null;
      throw error;
    }
  },
});

// ---- Reactive reads: drive the UI from these ------------------------------

export const myMachines = query({
  args: {},
  handler: async (ctx) => await boxd.list(ctx, { ownerId: await ownerId(ctx) }),
});

export const machine = query({
  args: lifecycle,
  handler: async (ctx, { machineId }) =>
    await boxd.get(ctx, { machineId, ownerId: await ownerId(ctx) }),
});

export const executions = query({
  args: { machineId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) =>
    await boxd.listExecutions(ctx, { ...args, ownerId: await ownerId(ctx) }),
});

export const execution = query({
  args: { executionId: v.string() },
  handler: async (ctx, { executionId }) =>
    await boxd.getExecution(ctx, { executionId, ownerId: await ownerId(ctx) }),
});
