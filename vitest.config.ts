import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // smoke/** is a separate, non-hermetic suite (real network calls to a
    // running app instance + Stripe's test-mode API + Convex) — it has its
    // own vitest.e2e.config.ts / `npm run test:e2e` so the default
    // `npx vitest run` stays fast and credential-free. See smoke/README.md.
    exclude: ["node_modules/**", ".next/**", "smoke/**"],
  },
});
