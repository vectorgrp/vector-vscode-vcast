import * as vscode from "vscode";

const RGW_GLOB = "**/requirements_gateway/requirements.json";

let sharedWatcher: vscode.FileSystemWatcher | undefined;

/**
 * Process-wide RGW watcher. Multiple consumers attach their own handlers
 * to the returned watcher so we don't burn separate inotify entries on
 * the same glob. Safe to call from multiple activation hooks.
 */
export function ensureRgwWatcher(
  context: vscode.ExtensionContext
): vscode.FileSystemWatcher {
  if (sharedWatcher) return sharedWatcher;

  sharedWatcher = vscode.workspace.createFileSystemWatcher(RGW_GLOB);
  context.subscriptions.push(sharedWatcher);
  context.subscriptions.push({
    dispose: () => {
      sharedWatcher = undefined;
    },
  });
  return sharedWatcher;
}
