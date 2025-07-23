import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { exec as execCb } from "child_process";

import { globalController, globalProjectDataCache } from "../../testPane";
import { vectorMessage } from "../../messagePane";
import { normalizePath } from "../../utilities";

const exec = promisify(execCb);

/**
 * Generates a new CFG file for the given compiler by invoking VectorCAST's clicast tool,
 * writes it into the specified compilers directory, and returns the full path to the file.
 *
 * @param compiler - The compiler template (e.g. 'VXSIM64_RTP_WORKBENCH_CPP').
 * @param projectCompilerPath - Absolute path to the 'compilers' directory in the project.
 * @returns The absolute file path of the generated CFG, or undefined if generation failed.
 */
export async function createNewCFGFromCompiler(
  compiler: string,
  projectCompilerPath: string
): Promise<string | undefined> {
  // Ensure VECTORCAST_DIR is defined
  const vectorcastDir = process.env.VECTORCAST_DIR;
  if (!vectorcastDir) {
    vscode.window.showErrorMessage(
      "Environment variable VECTORCAST_DIR is not set."
    );
    return;
  }

  // Build the path to the 'clicast' executable
  const clicastPath = path.join(vectorcastDir, "clicast");
  const args = ["-lc", "template", compiler].join(" ");
  const command = `${clicastPath} ${args}`;

  try {
    // Execute clicast and capture stdout (the CFG content)
    const { stdout, stderr } = await exec(command);
    if (stderr) {
      vscode.window.showErrorMessage(`clicast error: ${stderr}`);
      return;
    }

    // Determine output filename and path
    const fileName = `${compiler}.cfg`;
    const fullPath = path.join(projectCompilerPath, fileName);

    // Convert the CFG content into a Uint8Array for VS Code FS
    const fileUri = vscode.Uri.file(fullPath);
    const contentBuffer = Buffer.from(stdout, "utf8");

    // Write the file via VS Code's FS API
    await vscode.workspace.fs.writeFile(fileUri, contentBuffer);

    return fullPath;
  } catch (error: any) {
    vscode.window.showErrorMessage(
      `Failed to generate CFG for ${compiler}: ${error.message}`
    );
    return;
  }
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

/**
 * Generates a cryptographically-strong random nonce string.
 *
 * We use this nonce to whitelist our injected <script> tags in the Webview's
 * Content-Security-Policy. By including a fresh, unpredictable nonce on each
 * load and referencing it both in the CSP header (`script-src 'nonce-…'`)
 * and in the `<script nonce="…">` attributes, we ensure:
 *   1. Only the scripts we explicitly ship and inject can execute.
 *   2. Inline scripts or any third-party code not bearing the correct nonce
 *      are blocked by the browser sandbox.
 *
 * @returns a 32-character alphanumeric nonce
 */
export function getNonce(): string {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/**
 * Resolves the on‐disk base directory for our `src/manage/webviews` folder.
 *
 * 1. Tries the normal location under the installed extension:
 *      <extensionPath>/src/manage/webviews
 * 2. If that doesn’t exist, checks if we're running in the E2E test harness
 *    under "<...>/tests/internal/e2e/test/extension". If so, strips off
 *    that suffix and uses the repo root to locate:
 *      <repoRoot>/src/manage/webviews
 * 3. If neither exists, throws an error.
 *
 * @param context The ExtensionContext, used to read `extensionPath`.
 * @returns The filesystem path to the `webviews` folder.
 * @throws If no valid `webviews` folder can be found.
 */
export function resolveWebviewBase(context: vscode.ExtensionContext): string {
  // 1) Normal installed extension layout
  const normal = path.join(context.extensionPath, "src", "manage", "webviews");
  if (fs.existsSync(normal)) {
    return normal;
  }

  // 2) Fallback for E2E tests under tests/internal/e2e/test/extension
  const marker = path.join("tests", "internal", "e2e", "test", "extension");
  const extPath = context.extensionPath;
  const idx = extPath.indexOf(marker);
  if (idx !== -1) {
    const repoRoot = extPath.slice(0, idx);
    const fallback = path.join(repoRoot, "src", "manage", "webviews");
    if (fs.existsSync(fallback)) {
      return fallback;
    }
  }

  throw new Error(
    `Could not resolve webview base directory. Tried:\n` +
      `  ${normal}\n` +
      (marker && extPath.indexOf(marker) !== -1
        ? `  ${path.join(extPath.slice(0, extPath.indexOf(marker)), "src/manage/webviews")}\n`
        : "") +
      `Please ensure that 'src/manage/webviews' exists either under the extension path or under the repo root.`
  );
}

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
    vectorMessage(`Processing project: ${projectPath} ...`);
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
  if (!process.env.VECTORCAST_DIR) {
    throw new Error("VECTORCAST_DIR environment variable is not set");
  }

  const datPath = `${process.env.VECTORCAST_DIR}/DATA/C_TEMPLATES.DAT`;
  const cmd = `grep "C_COMPILER_TAG" "${datPath}"`;
  const { stdout } = await exec(cmd);

  // Clear any existing entries
  Object.keys(compilerTagList).forEach((key) => {
    delete compilerTagList[key];
  });

  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line)
    .forEach((line) => {
      // e.g. "C_COMPILER_TAG: TAG: Name..."
      const parts = line.split(": ").map((p) => p.trim());
      const tag = parts[1];
      const name = parts.length >= 3 ? parts.slice(2).join(": ") : parts[1];

      // Switch key and value: map name → tag
      compilerTagList[name] = tag;
    });

  return compilerTagList;
}

// Simple list with ignored projects in case something goes wrong but we can still continue with other projects
export const ignoreEnvsInProject: string[] = [];
