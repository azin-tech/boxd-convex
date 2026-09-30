import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Machines and executions live in the boxd component's tables. The app only
// keeps its sign-in tables and the demo's slots.
export default defineSchema({
  ...authTables,

  /**
   * One row per machine the public demo may run. A slot is taken in a
   * mutation before boxd is called, so the caps in demo.ts hold even when
   * visitors create machines at the same moment. The sweep frees it.
   */
  demoSlots: defineTable({
    ownerId: v.string(),
    /** Unset while the machine is being created. */
    machineId: v.optional(v.string()),
    expiresAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_expiry", ["expiresAt"])
    .index("by_machine", ["machineId"]),
});
