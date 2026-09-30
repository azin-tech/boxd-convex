/**
 * Bounds that keep every value this component stores or returns inside
 * Convex's limits: 1 MiB per document, 16 MiB per function return value,
 * and a 10 minute ceiling on an action.
 */

/** Stored per stream on an execution row: two of these stay far below 1 MiB. */
export const MAX_STORED_OUTPUT = 64_000;
/** Stored command line on an execution row. */
export const MAX_STORED_COMMAND = 4_000;
/** Stored error message on any row. */
export const MAX_STORED_ERROR = 4_000;
/**
 * Returned per stream from `exec`. A character is at most 3 UTF-8 bytes, so
 * two streams at this cap stay under the 16 MiB return limit.
 */
export const MAX_RETURNED_OUTPUT = 2_000_000;

/**
 * A command that outlives its action would leave its execution row stuck at
 * "running", because the action's `catch` never runs. So the remote command
 * is always bounded below the 10 minute action ceiling.
 */
export const DEFAULT_EXEC_TIMEOUT_MS = 540_000;
export const MAX_EXEC_TIMEOUT_MS = 570_000;

/** How long `create` and `fork` wait for the machine to accept an exec. */
export const DEFAULT_READY_TIMEOUT_MS = 120_000;
export const MAX_READY_TIMEOUT_MS = 480_000;

export const DEFAULT_LIST_LIMIT = 100;
export const MAX_LIST_LIMIT = 500;

const TRUNCATION_MARKER = "\n…[truncated]";

/** Truncate to at most `max` characters, the marker included. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = Math.max(0, max - TRUNCATION_MARKER.length);
  return `${text.slice(0, keep)}${TRUNCATION_MARKER}`;
}

/** A caller-supplied page size, forced into `[1, MAX_LIST_LIMIT]`. */
export function clampLimit(limit: number | undefined): number {
  const value = Math.floor(limit ?? DEFAULT_LIST_LIMIT);
  if (!Number.isFinite(value)) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.max(value, 1), MAX_LIST_LIMIT);
}
