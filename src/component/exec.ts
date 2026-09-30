/**
 * Run a command in a machine. Each run is recorded in `executions`
 * (running → completed or failed), so the app can render live status and
 * history from a reactive query.
 *
 * The call returns when the command exits. For work that can outlast the 10
 * minute action ceiling, start it in the background inside the machine
 * (`nohup ... &`) and poll it with later runs.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { action } from "./_generated/server.js";
import { withBoxd } from "./boxd.js";
import { errorMessage, isNotFound } from "./errors.js";
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  MAX_EXEC_TIMEOUT_MS,
  MAX_RETURNED_OUTPUT,
  MAX_STORED_COMMAND,
  MAX_STORED_OUTPUT,
  truncate,
} from "./limits.js";
import { requireMachine } from "./records.js";
import {
  boundedTimeout,
  requireAbsolutePath,
  requireNonEmpty,
} from "./validate.js";

const SAFE_ARG = /^[A-Za-z0-9_\-./=:@%+,]+$/;

/** How the command reads in a shell, for the execution row. */
function displayCommand(command: string | string[]): string {
  if (typeof command === "string") return command;
  return command
    .map((arg) =>
      SAFE_ARG.test(arg) ? arg : `'${arg.replace(/'/g, `'"'"'`)}'`,
    )
    .join(" ");
}

export const run = action({
  args: {
    machineId: v.string(),
    ownerId: v.optional(v.string()),
    /** A shell command line, or an argv array that is quoted for you. */
    command: v.union(v.string(), v.array(v.string())),
    /** Absolute working directory. A missing one fails the command. */
    cwd: v.optional(v.string()),
    /** Extra environment for this command only. Not stored. */
    env: v.optional(v.record(v.string(), v.string())),
    /** Kill the command after this many ms. Default 540s, capped at 570s. */
    timeoutMs: v.optional(v.number()),
  },
  returns: v.object({
    executionId: v.id("executions"),
    exitCode: v.number(),
    success: v.boolean(),
    stdout: v.string(),
    stderr: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    executionId: Id<"executions">;
    exitCode: number;
    success: boolean;
    stdout: string;
    stderr: string;
  }> => {
    // Validate before anything is recorded or sent.
    const timeout = boundedTimeout(
      args.timeoutMs,
      DEFAULT_EXEC_TIMEOUT_MS,
      MAX_EXEC_TIMEOUT_MS,
      "timeoutMs",
    );
    if (args.cwd !== undefined) requireAbsolutePath(args.cwd);
    const line = displayCommand(args.command);
    requireNonEmpty(line, "command");
    const machine = await requireMachine(ctx, args.machineId, args.ownerId);

    const executionId: Id<"executions"> = await ctx.runMutation(
      internal.executions.begin,
      {
        machineId: machine.machineId,
        ownerId: machine.ownerId,
        command: truncate(line, MAX_STORED_COMMAND),
        cwd: args.cwd,
        timeoutMs: timeout,
      },
    );
    try {
      const result = await withBoxd(ctx, (boxd) =>
        boxd.machines.exec(machine.machineId, {
          command: args.command,
          cwd: args.cwd,
          env: args.env,
          timeout,
        }),
      );
      await ctx.runMutation(internal.executions.finish, {
        executionId,
        status: "completed",
        exitCode: result.exitCode,
        stdout: truncate(result.stdout, MAX_STORED_OUTPUT),
        stderr: truncate(result.stderr, MAX_STORED_OUTPUT),
      });
      return {
        executionId,
        exitCode: result.exitCode,
        success: result.success,
        stdout: truncate(result.stdout, MAX_RETURNED_OUTPUT),
        stderr: truncate(result.stderr, MAX_RETURNED_OUTPUT),
      };
    } catch (error) {
      await ctx.runMutation(internal.executions.finish, {
        executionId,
        status: "failed",
        error: errorMessage(error),
      });
      if (isNotFound(error)) {
        // boxd no longer has the machine, e.g. after its auto-destroy timer.
        await ctx.runMutation(internal.machines.markDestroyed, {
          machineId: machine.machineId,
        });
      }
      throw error;
    }
  },
});
