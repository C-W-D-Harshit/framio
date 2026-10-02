import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/effect/**/*.test.ts"],
    environment: "node",
    testTimeout: 10_000,
  },
});
