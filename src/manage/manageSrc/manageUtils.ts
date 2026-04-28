import * as vscode from "vscode";
import * as fs1 from "fs";
import * as fs from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";

import { globalController, globalProjectDataCache } from "../../testPane";
import { vectorMessage } from "../../messagePane";
import { normalizePath } from "../../utilities";
import {
  clicastCommandToUse,
  vcastInstallationDirectory,
} from "../../vcastInstallation";

/**
 * Generates a new CFG file for the given compiler by invoking VectorCAST's clicast tool,
 * parses out the path of the generated CFG, copies it into the specified compilers directory,
 * and returns the full path to the copied file.
 *
 * @param compiler - The compiler template (e.g. 'VXSIM64_RTP_WORKBENCH_CPP').
 * @param projectCompilerPath - Absolute path to the 'compilers' directory in the project.
 * @returns The absolute file path of the copied CFG, or undefined if generation failed.
 */
export async function createNewCFGFromCompiler(
  compiler: string,
  projectCompilerPath: string
): Promise<string | undefined> {
  // Make sure compilers dir exists
  if (!fs1.existsSync(projectCompilerPath)) {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.file(projectCompilerPath)
    );
  }

  // spawn clicast *in* the compilers folder
  const args = ["-lc", "template", compiler];

  // This is checked at the beginning when initializing the data, but to be sure
  if (!fs1.existsSync(clicastCommandToUse)) {
    vectorMessage(`Clicast was not found. Cancelling compiler operation.`);
    return;
  }

  const proc = spawn(clicastCommandToUse, args, {
    cwd: projectCompilerPath,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });

  // wait for it to finish
  const code: number = await new Promise((res) => proc.on("close", res));
  if (code !== 0) {
    vscode.window.showErrorMessage(
      `clicast exited with code ${code} for ${compiler}`
    );
    return;
  }

  // the default CFG is now at compilers/CCAST_.CFG
  const generated = path.join(projectCompilerPath, "CCAST_.CFG");
  if (!fs1.existsSync(generated)) {
    vscode.window.showErrorMessage(`Expected CFG not found at ${generated}`);
    return;
  }

  vectorMessage(`Generated and moved CFG to ${generated}`);
  return generated;
}
/**
 * Searches the entire globalController for a test item with the specified id.
 * @param targetId The id of the test item to search for.
 * @returns The test item if found, otherwise undefined.
 */
export function findTestItemInController(
  targetId: string
): vscode.TestItem | undefined {
  let found: vscode.TestItem | undefined;
  globalController.items.forEach((item) => {
    found ??= findTestItemRecursively(item, targetId);
  });
  return found;
}

/**
 * Recursive helper that searches a test item and its children for a given id.
 * @param item The test item to search.
 * @param targetId The id of the test item to search for.
 * @returns
 */
function findTestItemRecursively(
  item: vscode.TestItem,
  targetId: string
): vscode.TestItem | undefined {
  if (item.id === targetId) {
    return item;
  }
  let found: vscode.TestItem | undefined;
  item.children.forEach((child) => {
    found ??= findTestItemRecursively(item, targetId);
  });
  return found;
}

// `getNonce` and `resolveWebviewBase` were moved to src/webviewUtils.ts so the
// requirements webview and any future webviews can share them.

/**
 * Adds environments that are part of a managed project (from globalProjectDataCache).
 * @param globalProjectDataCache A Map containing project data.
 * @param projectPathDirList A list to hold project directory paths.
 * @param environmentList A list to push environment data.
 * @param workspaceRoot The workspace root directory path.
 */
export function addManagedEnvironments(
  projectPathDirList: string[],
  environmentList: any[],
  workspaceRoot: string
): void {
  for (const [projectPath, projectData] of globalProjectDataCache) {
    vectorMessage(`Processing project: ${path.basename(projectPath)} ...`);
    projectPathDirList.push(projectPath.split(".vcm")[0]);
    for (const [buildDirectory, enviroData] of projectData) {
      environmentList.push({
        projectPath: normalizePath(projectPath),
        buildDirectory: normalizePath(buildDirectory),
        isBuilt: enviroData.isBuilt,
        displayName: enviroData.displayName, // e.g. "GNU/BlackBox/ENV"
        workspaceRoot: normalizePath(workspaceRoot),
      });
    }
  }
}

interface CompilerList {
  [tag: string]: string;
}

export const compilerTagList: CompilerList = {};

/**
 * Runs `grep "C_COMPILER_TAG"` on the VectorCAST C_TEMPLATES.DAT file
 * and updates the exported `compilerList` in-place.
 */
export async function setCompilerList(): Promise<CompilerList> {
  if (!vcastInstallationDirectory) {
    throw new Error("VectorCAST installation directory is not available");
  }

  const datPath = normalizePath(
    path.join(vcastInstallationDirectory, "DATA", "C_TEMPLATES.DAT")
  );

  const fileContents = await fs.readFile(datPath, "utf-8");

  const lines = fileContents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("C_COMPILER_TAG"));

  Object.keys(compilerTagList).forEach((key) => {
    delete compilerTagList[key];
  });

  lines.forEach((line) => {
    const parts = line.split(": ").map((p) => p.trim());
    const tag = parts[1];
    const name = parts.length >= 3 ? parts.slice(2).join(": ") : parts[1];
    compilerTagList[name] = tag;
  });

  return compilerTagList;
}

// Simple list with ignored projects in case something goes wrong but we can still continue with other projects
export const ignoreEnvsInProject: string[] = [];
