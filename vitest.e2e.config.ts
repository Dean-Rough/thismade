import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate config for the live Phase 2 gate smoke test (smoke/*.test.ts).
// Deliberately NOT merged into vitest.config.ts: that default suite is fully
// hermetic (mocked Convex + Stripe boundaries) and must stay runnable with
// zero external credentials. This one makes real network calls and requires
// real setup — see smoke/README.md. Run with `npm run test:e2e`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["smoke/**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // The live flow (Stripe test-mode network calls, a headless browser
    // completing hosted Checkout, and webhook-delivery polling) genuinely
    // takes longer than a mocked unit test.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
