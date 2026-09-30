/**
 * Helpers shared by the action modules: turning an SDK `Machine` into row
 * fields, the tenant check, and failure bookkeeping.
 */

import type { Machine } from "@boxd-sh/sdk/web";
import type { Infer } from "convex/values";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { ActionCtx } from "./_generated/server.js";
import { boxdError, errorMessage } from "./errors.js";
import schema from "./schema.js";

export const machineDoc = schema.tables.machines.validator.extend({
  _id: v.id("machines"),
  _creationTime: v.number(),
});
export type MachineDoc = Infer<typeof machineDoc>;

export const executionDoc = schema.tables.executions.validator.extend({
  _id: v.id("executions"),
  _creationTime: v.number(),
});

/** The row fields boxd owns, read off an SDK `Machine`. */
export function observed(machine: Machine) {
  return {
    machineId: machine.id,
    name: machine.name,
    status: machine.status,
    image: machine.imageRef || undefined,
    url: machine.access.url || undefined,
    vcpu: machine.resources.vcpu || undefined,
    memoryBytes: machine.resources.memoryBytes || undefined,
  };
}

/**
 * The machine's row, if it exists and belongs to `ownerId`.
 *
 * `ownerId` must match exactly: a machine created without one is only
 * reachable without one. A mismatch reads as NOT_FOUND, so a caller can't
 * probe for other tenants' machines.
 */
export async function requireMachine(
  ctx: ActionCtx,
  machineId: string,
  ownerId: string | undefined,
): Promise<MachineDoc> {
  const row = await ctx.runQuery(internal.machines.record, { machineId });
  if (!row || row.ownerId !== ownerId) {
    throw boxdError(
      "NOT_FOUND",
      `no machine ${machineId} is managed by this component for this owner`,
    );
  }
  return row;
}

/** Store the failure on the machine's row, then rethrow it. */
export async function recordFailure(
  ctx: ActionCtx,
  machineId: string,
  error: unknown,
): Promise<never> {
  await ctx.runMutation(internal.machines.setError, {
    machineId,
    error: errorMessage(error),
  });
  throw error;
}
