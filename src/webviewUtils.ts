import * as vscode from "vscode";

const path = require("path");
const fs = require("fs");

/**
 * Generate a fresh 32-character alphanumeric nonce. Used to gate `<script>`
 * execution in webview panels via `script-src 'nonce-…'`.
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
 * Resolve the on-disk path to a webview-asset folder under `src/`.
 *
 * 1. Tries the normal installed-extension location: `<extensionPath>/src/<...subpath>`.
 * 2. Falls back to the repo root when running under the E2E test harness
 *    (`<...>/tests/internal/e2e/test/extension`): strips that suffix off
 *    `extensionPath` and looks up `<repoRoot>/src/<...subpath>` instead.
 * 3. Throws if neither exists.
 *
 * Example: `resolveWebviewBase(context, "manage", "webviews")` →
 * `<root>/src/manage/webviews`.
 */
export function resolveWebviewBase(
  context: vscode.ExtensionContext,
  ...subpath: string[]
): string {
  const segments = ["src", ...subpath];
  const normal = path.join(context.extensionPath, ...segments);
  if (fs.existsSync(normal)) return normal;

  const marker = path.join("tests", "internal", "e2e", "test", "extension");
  const extPath = context.extensionPath;
  const idx = extPath.indexOf(marker);
  if (idx !== -1) {
    const repoRoot = extPath.slice(0, idx);
    const fallback = path.join(repoRoot, ...segments);
    if (fs.existsSync(fallback)) return fallback;
  }

  throw new Error(
    `Could not resolve webview base directory '${segments.join("/")}'. Tried:\n  ${normal}` +
      (idx !== -1
        ? `\n  ${path.join(extPath.slice(0, idx), ...segments)}`
        : "")
  );
}
