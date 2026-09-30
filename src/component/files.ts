/**
 * Files inside a machine. Whole files cross the function boundary, so each
 * is capped well below Convex's 16 MiB argument and return limits. Move
 * bigger files with `exec` (for example `curl` to or from storage).
 */

import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server.js";
import { withBoxd } from "./boxd.js";
import { invalidArgument } from "./errors.js";
import { requireMachine } from "./records.js";
import { requireAbsolutePath } from "./validate.js";

/** Largest file `readFile` returns or `writeFile` accepts. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

const target = {
  machineId: v.string(),
  ownerId: v.optional(v.string()),
  /** Absolute path inside the machine. */
  path: v.string(),
};

function requireSize(bytes: number, path: string): void {
  if (bytes > MAX_FILE_BYTES) {
    throw invalidArgument(
      `${path} is ${bytes} bytes, over the ${MAX_FILE_BYTES} byte limit. ` +
        "Move large files with exec instead.",
    );
  }
}

async function download(
  ctx: ActionCtx,
  args: { machineId: string; ownerId?: string; path: string },
): Promise<Uint8Array> {
  requireAbsolutePath(args.path);
  await requireMachine(ctx, args.machineId, args.ownerId);
  const bytes = await withBoxd(ctx, (boxd) =>
    boxd.machines.files.download(args.machineId, args.path),
  );
  requireSize(bytes.byteLength, args.path);
  return bytes;
}

/** Read a file as UTF-8 text. A file that isn't valid UTF-8 is refused. */
export const readFile = action({
  args: target,
  returns: v.string(),
  handler: async (ctx, args) => {
    const bytes = await download(ctx, args);
    try {
      // Strict: a lenient decode would turn each bad byte into a 3-byte
      // U+FFFD, and could push a binary file past the return limit.
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw invalidArgument(
        `${args.path} is not UTF-8 text. Read it with readFileBytes.`,
      );
    }
  },
});

/** Read a file byte for byte. */
export const readFileBytes = action({
  args: target,
  returns: v.bytes(),
  handler: async (ctx, args) => {
    const bytes = await download(ctx, args);
    // A standalone copy: `bytes` can be a view into a larger buffer.
    return bytes.slice().buffer;
  },
});

/** Create or replace a file. The parent directory must exist. */
export const writeFile = action({
  args: { ...target, content: v.union(v.string(), v.bytes()) },
  returns: v.object({ bytesWritten: v.number() }),
  handler: async (ctx, { machineId, ownerId, path, content }) => {
    requireAbsolutePath(path);
    const data =
      typeof content === "string"
        ? new TextEncoder().encode(content)
        : new Uint8Array(content);
    requireSize(data.byteLength, path);
    await requireMachine(ctx, machineId, ownerId);
    const bytesWritten = await withBoxd(ctx, (boxd) =>
      boxd.machines.files.upload(machineId, path, data),
    );
    return { bytesWritten };
  },
});

/** The immediate contents of a directory. */
export const listDir = action({
  args: target,
  returns: v.object({
    entries: v.array(
      v.object({
        name: v.string(),
        isDir: v.boolean(),
        sizeBytes: v.number(),
        permissions: v.string(),
        /** Epoch milliseconds. */
        modifiedAt: v.number(),
      }),
    ),
    /** The directory held more entries than boxd returns in one listing. */
    truncated: v.boolean(),
  }),
  handler: async (ctx, { machineId, ownerId, path }) => {
    requireAbsolutePath(path);
    await requireMachine(ctx, machineId, ownerId);
    const listing = await withBoxd(ctx, (boxd) =>
      boxd.machines.files.listDir(machineId, path),
    );
    return {
      entries: listing.entries.map((entry) => ({
        name: entry.name,
        isDir: entry.isDir,
        sizeBytes: entry.sizeBytes,
        permissions: entry.permissions,
        modifiedAt: entry.modifiedAt.getTime(),
      })),
      truncated: listing.truncated,
    };
  },
});
