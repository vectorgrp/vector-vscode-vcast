// vite.config.ts
import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./tests/unit/setup-unit-test.ts",
    coverage: {
      reporter: ["text", "json", "html", "clover", "lcov"],
    },
    exclude: [...configDefaults.exclude, "tests/internal/e2e/test/specs/*"],
  },
});
