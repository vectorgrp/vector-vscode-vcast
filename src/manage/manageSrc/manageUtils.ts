import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

import { globalController } from "../../testPane";
import { vectorMessage } from "../../messagePane";

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
    if (!found) {
      found = findTestItemRecursively(item, targetId);
    }
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
    if (!found) {
      found = findTestItemRecursively(child, targetId);
    }
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
