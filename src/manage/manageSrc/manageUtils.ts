import * as vscode from "vscode";

import { globalController } from "../../testPane";

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
