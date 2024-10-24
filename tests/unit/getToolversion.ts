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
