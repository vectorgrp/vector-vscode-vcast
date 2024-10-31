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
export async function getToolVersion(givenClicastPath?: string) {
  let toolVersionPath = "";
  // For the E2E, we provide a given path.
  if (givenClicastPath) {
    toolVersionPath = path.join(
      givenClicastPath,
      "..",
      "DATA",
      "tool_version.txt"
    );
  } else {
    // For unit tests we need to find the clicast path first.
    let clicastExecutablePath = "";
    const checkClicast =
      process.platform === "win32" ? "where clicast" : "which clicast";

    try {
      // Execute the command to find clicast
      const { stdout, stderr } = await promisifiedExec(checkClicast);

      if (stderr) {
        throw new Error(
          `Error when running ${checkClicast}, make sure clicast is on PATH`
        );
      }

      clicastExecutablePath = stdout.trim();
      console.log(`clicast found in ${clicastExecutablePath}`);
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

    toolVersionPath = path.join(
      clicastExecutablePath,
      "..",
      "DATA",
      "tool_version.txt"
    );
  }

  try {
    const toolVersion: string = fs
      .readFileSync(toolVersionPath)
      .toString()
      .trim();

    // Extract the first two characters & try to cast it to a number
    const firstTwoChars = toolVersion.slice(0, 2);
    const versionNumber = Number(firstTwoChars);

    // Check if the conversion was successful (not NaN)
    if (Number.isNaN(versionNumber)) {
      console.error(`Error: Could not cast "${firstTwoChars}" to a number`);
      return Number.NaN;
    }

    return versionNumber;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error reading tool version: ${error.message}`);
    } else {
      console.error(`Unexpected error: ${String(error)}`);
    }

    return Number.NaN;
  }
}

/**
 * Function to get the clicast executable path and check if the tool version supports server runnability
 */
export async function checkForServerRunnability(
  givenClicastPath?: string
): Promise<boolean> {
  let toolVersionPath = "";

  // Set toolVersionPath based on given path or locate clicast executable
  if (givenClicastPath) {
    toolVersionPath = path.join(
      givenClicastPath,
      "..",
      "DATA",
      "tool_version.txt"
    );
  } else {
    const checkClicast =
      process.platform === "win32" ? "where clicast" : "which clicast";
    try {
      const { stdout, stderr } = await promisifiedExec(checkClicast);
      if (stderr) throw new Error(`Error: make sure clicast is on PATH`);

      const clicastExecutablePath = stdout.trim();
      toolVersionPath = path.join(
        clicastExecutablePath,
        "..",
        "DATA",
        "tool_version.txt"
      );
    } catch (error) {
      console.error(
        `Error locating clicast: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  // Read and validate tool version from toolVersionPath
  try {
    const toolVersion: string = fs
      .readFileSync(toolVersionPath, "utf-8")
      .trim();
    const [majorVersionStr, spPart] = toolVersion.split(".sp");

    // The version number
    const majorVersion = Number(majorVersionStr);
    // Split away the date (4 (23/10/24) --> 4)
    const spVersion = Number(spPart.split(" ")[0]);

    // Check if major version and sp version meet the criteria
    if (majorVersion < 24 || (majorVersion === 24 && spVersion < 5)) {
      console.log(
        `Version ${toolVersion} does not meet the minimum requirement of 24sp5.`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `Error reading tool version: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}
