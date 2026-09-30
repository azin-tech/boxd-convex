/**
 * App-facing client for the boxd Convex component.
 *
 * Create one with `components.boxd` in your `convex/` directory and call it
 * from your queries and actions. Reads (`get`, `list`, `listExecutions`,
 * `getExecution`) run in queries and are reactive. Everything that talks to
 * boxd runs in actions.
 *
 * The component can't see your users: `ctx.auth` doesn't reach into a
 * component. Derive `ownerId` from your own auth and pass it on every call.
 * Never take it from a client argument. A machine created with an `ownerId`
 * is reachable only with that same `ownerId`.
 */

import { ConvexError, type Infer } from "convex/values";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  GenericActionCtx,
  GenericDataModel,
  GenericQueryCtx,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import type { BoxdErrorData, errorCode } from "../component/errors.js";

type QueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type ActionCtx = Pick<
  GenericActionCtx<GenericDataModel>,
  "runQuery" | "runMutation" | "runAction"
>;

type Machines = ComponentApi["machines"];
type Args<F extends FunctionReference<any, "internal">> = FunctionArgs<F>;
type Returns<F extends FunctionReference<any, "internal">> =
  FunctionReturnType<F>;

/** A machine's row: boxd's last observed state plus the component's fields. */
export type MachineRecord = Returns<Machines["create"]>;
/** One `exec`, as stored in the component. */
export type ExecutionRecord = NonNullable<
  Returns<ComponentApi["executions"]["get"]>
>;
export type ExecResult = Returns<ComponentApi["exec"]["run"]>;
export type DirListing = Returns<ComponentApi["files"]["listDir"]>;

export type CreateArgs = Args<Machines["create"]>;
export type ForkArgs = Args<Machines["fork"]>;
export type ExecArgs = Args<ComponentApi["exec"]["run"]>;
export type ExposeArgs = Args<Machines["expose"]>;

/** Addresses one machine: its boxd id, and the owner it belongs to. */
export type MachineRef = { machineId: string; ownerId?: string };
/** Addresses a machine that wakes up: optionally wait until it takes an exec. */
export type WakeArgs = Args<Machines["start"]>;
export type FileRef = MachineRef & { path: string };

export type BoxdErrorCode = Infer<typeof errorCode>;
export type { BoxdErrorData, ComponentApi };

/**
 * True when `error` is a `ConvexError` this component threw, and, with
 * `code`, carries that code:
 *
 * ```ts
 * if (isBoxdError(error, "NOT_FOUND")) return null;
 * ```
 */
export function isBoxdError(
  error: unknown,
  code?: BoxdErrorCode,
): error is ConvexError<BoxdErrorData> {
  if (!(error instanceof ConvexError)) return false;
  const data = error.data as Partial<BoxdErrorData> | null;
  if (typeof data !== "object" || data === null) return false;
  if (typeof data.code !== "string" || typeof data.message !== "string") {
    return false;
  }
  return code === undefined || data.code === code;
}

export class Boxd {
  constructor(public readonly component: ComponentApi) {}

  // ---- Reactive reads (component tables only, no boxd call) --------------

  /** The machine's row, or null if it doesn't exist for this owner. */
  async get(ctx: QueryCtx, args: MachineRef) {
    return await ctx.runQuery(this.component.machines.get, args);
  }

  /** The owner's machines, newest first, destroyed ones included. */
  async list(ctx: QueryCtx, args: { ownerId?: string; limit?: number } = {}) {
    return await ctx.runQuery(this.component.machines.list, args);
  }

  /** A machine's executions, newest first. */
  async listExecutions(ctx: QueryCtx, args: MachineRef & { limit?: number }) {
    return await ctx.runQuery(this.component.executions.list, args);
  }

  /** One execution by the id `exec` returned, or null. */
  async getExecution(
    ctx: QueryCtx,
    args: { executionId: string; ownerId?: string },
  ) {
    return await ctx.runQuery(this.component.executions.get, args);
  }

  // ---- Lifecycle -----------------------------------------------------------

  /** Create a machine and, by default, wait until it accepts an exec. */
  async create(ctx: ActionCtx, args: CreateArgs = {}) {
    return await ctx.runAction(this.component.machines.create, args);
  }

  /** Fork a machine, disk and memory, into a new one with the same owner. */
  async fork(ctx: ActionCtx, args: ForkArgs) {
    return await ctx.runAction(this.component.machines.fork, args);
  }

  /** Re-read the machine from boxd into its row. */
  async refresh(ctx: ActionCtx, args: MachineRef) {
    return await ctx.runAction(this.component.machines.refresh, args);
  }

  /** Boot a stopped machine. */
  async start(ctx: ActionCtx, args: WakeArgs) {
    return await ctx.runAction(this.component.machines.start, args);
  }

  /** Shut the machine down. The disk is kept. */
  async stop(ctx: ActionCtx, args: MachineRef) {
    return await ctx.runAction(this.component.machines.stop, args);
  }

  /** Suspend to RAM. An exec or an HTTPS request wakes it again. */
  async pause(ctx: ActionCtx, args: MachineRef) {
    return await ctx.runAction(this.component.machines.pause, args);
  }

  /** Resume a paused machine. */
  async resume(ctx: ActionCtx, args: WakeArgs) {
    return await ctx.runAction(this.component.machines.resume, args);
  }

  /** Suspend to disk, freeing the host's memory. */
  async hibernate(ctx: ActionCtx, args: MachineRef) {
    return await ctx.runAction(this.component.machines.hibernate, args);
  }

  /** Restore a hibernated machine, memory included. */
  async wake(ctx: ActionCtx, args: WakeArgs) {
    return await ctx.runAction(this.component.machines.wake, args);
  }

  /** Destroy the machine. Its row stays, with status "destroyed". */
  async destroy(ctx: ActionCtx, args: MachineRef) {
    return await ctx.runAction(this.component.machines.destroy, args);
  }

  /**
   * Route public HTTPS to a port. Without `name`: the machine's default URL.
   * With `name`: an extra `https://<name>.<machine>.<zone>`.
   */
  async expose(ctx: ActionCtx, args: ExposeArgs) {
    return await ctx.runAction(this.component.machines.expose, args);
  }

  // ---- Commands and files ------------------------------------------------

  /** Run a command and wait for it to exit. Recorded in `executions`. */
  async exec(ctx: ActionCtx, args: ExecArgs) {
    return await ctx.runAction(this.component.exec.run, args);
  }

  /** Read a file as UTF-8 text. */
  async readFile(ctx: ActionCtx, args: FileRef) {
    return await ctx.runAction(this.component.files.readFile, args);
  }

  /** Read a file byte for byte. */
  async readFileBytes(ctx: ActionCtx, args: FileRef) {
    return await ctx.runAction(this.component.files.readFileBytes, args);
  }

  /** Create or replace a file from text or bytes. */
  async writeFile(
    ctx: ActionCtx,
    args: FileRef & { content: string | ArrayBuffer },
  ) {
    return await ctx.runAction(this.component.files.writeFile, args);
  }

  /** The immediate contents of a directory. */
  async listDir(ctx: ActionCtx, args: FileRef) {
    return await ctx.runAction(this.component.files.listDir, args);
  }
}
