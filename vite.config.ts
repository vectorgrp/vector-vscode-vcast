// Vite.config.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { defineConfig, configDefaults } from "vitest/config";

const promisifiedExec = promisify(exec);

/**
 *  Function to get the clicast executable path and check the tool version
 */
async function getToolVersion() {
  // Determine the command to locate clicast
  const checkClicast =
    process.platform === "win32" ? "where clicast" : "which clicast";

  let clicastExecutablePath = "";

  try {
    // Execute the command to find clicast
    const { stdout, stderr } = await promisifiedExec(checkClicast);
    if (stderr) {
      throw new Error(
        `Error when running ${checkClicast}, make sure clicast is on PATH`
      );
    } else {
      clicastExecutablePath = stdout.trim();
      console.log(`clicast found in ${clicastExecutablePath}`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    throw new Error(
      `Error when running "${checkClicast}", make sure clicast is on PATH`
    );
  }

  // Read the tool version from the appropriate path
  const toolVersionPath = path.join(
    clicastExecutablePath,
    "..",
    "DATA",
    "tool_version.txt"
  );

  try {
    const toolVersion: string = fs
      .readFileSync(toolVersionPath)
      .toString()
      .trim();
    return toolVersion;
  } catch (error) {
    console.error(`Error reading tool version: ${error.message}`);
    return "";
  }
}

// Export the Vitest configuration, including the conditional exclusion of tests
export default defineConfig(async () => {
  const toolVersion = await getToolVersion();

  // Determine the files to exclude based on the tool version
  const excludeCodedTestFiles = toolVersion.startsWith("23")
    ? ["tests/unit/ct-*"]
    : [];

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
