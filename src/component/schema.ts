import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * A reactive mirror of one boxd machine this component created or forked.
 *
 * boxd stays the source of truth: every lifecycle action writes back the
 * status it observed, and `machines.refresh` re-reads it on demand. The row
 * outlives the machine (status `"destroyed"`) so its execution history stays
 * readable.
 */
export const machineFields = {
  /** boxd machine id. External, not a Convex document id. */
  machineId: v.string(),
  name: v.string(),
  /**
   * Opaque tenant key from the host app. Components can't read `ctx.auth`, so
   * the app derives this from its own auth and every call must present the
   * same value to touch the machine.
   */
  ownerId: v.optional(v.string()),
  /** Last observed boxd status: `running`, `suspended`, `hibernated`, ... */
  status: v.string(),
  image: v.optional(v.string()),
  /** `https://<name>.<zone>`, the machine's default HTTPS route. */
  url: v.optional(v.string()),
  vcpu: v.optional(v.number()),
  memoryBytes: v.optional(v.number()),
  /** Set when this machine is a fork of another machine. */
  forkedFrom: v.optional(v.string()),
  /** The last failed operation's message. Cleared by the next success. */
  lastError: v.optional(v.string()),
  updatedAt: v.number(),
};

export const executionStatus = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

/** One row per `exec`, so the app can render live status and history. */
export const executionFields = {
  machineId: v.string(),
  ownerId: v.optional(v.string()),
  /** The command line that ran, truncated for storage. */
  command: v.string(),
  cwd: v.optional(v.string()),
  status: executionStatus,
  exitCode: v.optional(v.number()),
  /** Truncated for storage; the action's return value carries more. */
  stdout: v.optional(v.string()),
  stderr: v.optional(v.string()),
  error: v.optional(v.string()),
  startedAt: v.number(),
  finishedAt: v.optional(v.number()),
};

export default defineSchema({
  machines: defineTable(machineFields)
    .index("by_machine_id", ["machineId"])
    .index("by_owner", ["ownerId"]),
  executions: defineTable(executionFields).index("by_machine", ["machineId"]),
  /**
   * Cached session tokens, keyed by a SHA-256 of the API key and endpoint.
   * boxd rate-limits the key-for-token exchange per source IP, and every
   * Convex deployment in a region shares a few egress IPs, so each action
   * must reuse the token rather than exchange the key again. Internal only:
   * nothing in the component's public API returns these rows.
   */
  sessions: defineTable({
    keyHash: v.string(),
    token: v.string(),
    /** Epoch milliseconds. */
    expiresAt: v.number(),
  }).index("by_key_hash", ["keyHash"]),
});
