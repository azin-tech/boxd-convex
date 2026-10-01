import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The page reads CONVEX_URL, which `npx convex dev` writes to the repo's
// .env.local. For a production build, set CONVEX_URL in the environment.
export default defineConfig({
  root: import.meta.dirname,
  envDir: "..",
  envPrefix: ["VITE_", "CONVEX_URL"],
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
