// Vite.config.ts
import { defineConfig, configDefaults } from "vitest/config";
import { getToolVersion } from "./tests/unit/getToolversion";

// Export the Vitest configuration, including the conditional exclusion of tests
export default defineConfig(async () => {
  const toolVersion = await getToolVersion();

  // Determine the files to exclude based on the tool version
  const excludeCodedTestFiles = toolVersion < 24 ? ["tests/unit/ct-*"] : [];

  return {
    test: {
      globalSetup: "./tests/unit/setup-unit-test.ts",
      coverage: {
        reporter: ["text", "json", "html", "clover", "lcov"],
      },
      exclude: [
        ...configDefaults.exclude,
        "tests/internal/e2e/test/specs/*",
        ...excludeCodedTestFiles,
      ],
    },
  };
});
