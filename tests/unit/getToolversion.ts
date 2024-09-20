import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const promisifiedExec = promisify(exec);

/**
 * Function to get the clicast executable path and check the tool version
 */
export async function getToolVersion() {
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
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(`Unexpected error: ${String(error)}`);
    }

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
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error reading tool version: ${error.message}`);
    } else {
      console.error(`Unexpected error: ${String(error)}`);
    }

    return "";
  }
}
