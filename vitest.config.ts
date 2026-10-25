import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Tests must never reach the network: test/setup.ts blocks fetch to non-local hosts.
    setupFiles: ["test/setup.ts"],
    testTimeout: 20_000,
  },
});
