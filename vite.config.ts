// vite.config.ts
import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./tests/unit/setupUnitTest.ts",
    coverage: {
      reporter: ["text", "json", "html"],
    },
    exclude: [...configDefaults.exclude, "tests/internal/e2e/test/specs/*"],
  },
});
