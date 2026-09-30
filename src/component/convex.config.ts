import { defineComponent } from "convex/server";
import { v } from "convex/values";

export default defineComponent("boxd", {
  env: {
    BOXD_API_KEY: v.string(),
    BOXD_BASE_URL: v.optional(v.string()),
  },
});
