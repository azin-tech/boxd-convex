import { defineApp } from "convex/server";
import { v } from "convex/values";
import boxd from "@boxd-sh/convex/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

// Declare the key as app env, then bind it into the component by reference:
// the component reads it from its own env, so it never travels as a function
// argument. Set it with `npx convex env set BOXD_API_KEY bxd_...`.
const app = defineApp({
  env: {
    BOXD_API_KEY: v.string(),
    BOXD_BASE_URL: v.optional(v.string()),
  },
});

app.use(boxd, {
  env: {
    BOXD_API_KEY: app.env.BOXD_API_KEY,
    BOXD_BASE_URL: app.env.BOXD_BASE_URL,
  },
});

// The public demo (demo.ts) rate-limits machine creation and commands.
app.use(rateLimiter);

export default app;
