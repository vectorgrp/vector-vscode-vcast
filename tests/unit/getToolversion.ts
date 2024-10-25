/* eslint-disable unicorn/filename-case */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const promisifiedExec = promisify(exec);

/**
 * Function to get the clicast executable path and check the tool version
 */
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

    // Extract the first two characters & try to cast it to a number
    const firstTwoChars = toolVersion.slice(0, 2);
    const versionNumber = Number(firstTwoChars);

    // Check if the conversion was successful (not NaN)
    if (!isNaN(versionNumber)) {
      return versionNumber;
    } else {
      console.error(`Error: Could not cast "${firstTwoChars}" to a number`);
      return NaN;
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error reading tool version: ${error.message}`);
    } else {
      console.error(`Unexpected error: ${String(error)}`);
    }

    return NaN;
  }
}
