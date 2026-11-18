/**
 * Emulator pass (P2 §1.1): re-runs the core concurrency, lifecycle and payment suites against
 * the Firestore emulator. Run via `npm run test:emulator` (wraps `firebase emulators:exec`,
 * which sets FIRESTORE_EMULATOR_HOST). Files run serially because each test resets the
 * emulator database.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "node_modules/next/dist/compiled/server-only/empty.js"),
    },
  },
  test: {
    include: ["tests/unit/server/core/**/*.test.ts", "tests/unit/server/payments/**/*.test.ts"],
    exclude: ["tests/unit/server/core/memory-docstore.test.ts"],
    environment: "node",
    env: { TAKI_TEST_STORE: "emulator", GCLOUD_PROJECT: "demo-taki" },
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
