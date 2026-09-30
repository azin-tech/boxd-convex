/**
 * The session-token cache behind every boxd call. Internal functions only:
 * the app can't read a token through the component's API.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";

const session = v.object({ token: v.string(), expiresAt: v.number() });

export const get = internalQuery({
  args: { keyHash: v.string() },
  returns: v.union(v.null(), session),
  handler: async (ctx, { keyHash }) => {
    const row = await ctx.db
      .query("sessions")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash))
      .unique();
    return row ? { token: row.token, expiresAt: row.expiresAt } : null;
  },
});

export const put = internalMutation({
  args: { keyHash: v.string(), token: v.string(), expiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sessions")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", args.keyHash))
      .unique();
    if (row) {
      // Two actions can exchange at the same time. Keep the token that lives
      // longer, so a slow writer never replaces a fresher one.
      if (row.expiresAt < args.expiresAt) {
        await ctx.db.patch("sessions", row._id, {
          token: args.token,
          expiresAt: args.expiresAt,
        });
      }
    } else {
      await ctx.db.insert("sessions", args);
    }
    return null;
  },
});

/** Forget a token boxd rejected, so the next call exchanges the key again. */
export const drop = internalMutation({
  args: { keyHash: v.string(), token: v.string() },
  returns: v.null(),
  handler: async (ctx, { keyHash, token }) => {
    const row = await ctx.db
      .query("sessions")
      .withIndex("by_key_hash", (q) => q.eq("keyHash", keyHash))
      .unique();
    // Only drop the token that failed: another action may already have
    // stored a fresh one.
    if (row && row.token === token) await ctx.db.delete("sessions", row._id);
    return null;
  },
});
