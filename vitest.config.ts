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
    // storefront-template/** is its own Next.js + Convex repo (a scaffold
    // source, copied out per business by scripts/scaffold-storefront.mjs) —
    // it has its own package.json `npm run gate`, own tsconfig, own "@/"
    // alias root; running it through the platform's vitest/tsc config
    // resolves "@/..." imports against this repo's root instead of its own.
    exclude: ["node_modules/**", ".next/**", "smoke/**", "storefront-template/**"],
  },
});
