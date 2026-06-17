import * as vscode from "vscode";
import * as path from "node:path";

import { getNonce, resolveWebviewBase } from "../webviewUtils";
import type {
  ReqsCheckFunctionEntry,
  VerificationFinding,
} from "./requirementsChecking";

export interface VerificationSession {
  enviroPath: string;
  envName: string;
  ranAt: number;
  entries: ReqsCheckFunctionEntry[];
  findings: VerificationFinding[];
  staleIds: Set<string>;
  /** Source files whose on-disk mtime is newer than the env's last
   * build, meaning the stored TU line mapping no longer matches their
   * current contents. */
  outOfSyncFiles: Set<string>;
}

type FromWebview =
  | { type: "open-source"; file: string; line: number; id: string }
  | { type: "reverify" };

const panelByEnv = new Map<string, vscode.WebviewPanel>();

export function showVerificationReport(
  context: vscode.ExtensionContext,
  session: VerificationSession,
  callbacks: { onReverify: () => void; onClose: () => void }
): vscode.WebviewPanel {
  const existing = panelByEnv.get(session.enviroPath);
  if (existing) {
    existing.webview.postMessage({ type: "update", state: toWireState(session) });
    existing.reveal(undefined, true);
    return existing;
  }

  const baseDir = resolveWebviewBase(context, "requirements", "webviews");
  const panel = vscode.window.createWebviewPanel(
    "vectorcastReqs2checkReport",
    `Verify: ${session.envName}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(baseDir)],
    }
  );
  panel.webview.html = buildShell(panel.webview, baseDir, session);

  panel.webview.onDidReceiveMessage(
    async (msg: FromWebview) => {
      if (msg?.type === "open-source") {
        await openFileAtLine(msg.file, msg.line);
      } else if (msg?.type === "reverify") {
        callbacks.onReverify();
      }
    },
    undefined,
    context.subscriptions
  );

  panel.onDidDispose(
    () => {
      panelByEnv.delete(session.enviroPath);
      callbacks.onClose();
    },
    null,
    context.subscriptions
  );

  panelByEnv.set(session.enviroPath, panel);
  return panel;
}

export function refreshVerificationReport(
  enviroPath: string,
  session: VerificationSession
): void {
  const panel = panelByEnv.get(enviroPath);
  if (panel) {
    panel.webview.postMessage({ type: "update", state: toWireState(session) });
  }
}

export function closeVerificationReport(enviroPath: string): void {
  panelByEnv.get(enviroPath)?.dispose();
}

async function openFileAtLine(file: string, line: number): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    });
    const zeroLine = Math.max(0, line - 1);
    const range = new vscode.Range(zeroLine, 0, zeroLine, 0);
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Could not open ${file}:${line}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** JSON-safe state shape consumed by `verificationReport.js`. Sets get
 * flattened to arrays; the report doesn't need `originalText` so we drop
 * it to keep the wire payload small. */
function toWireState(session: VerificationSession) {
  return {
    envName: session.envName,
    ranAt: session.ranAt,
    findings: session.findings.map((f) => ({
      id: f.id,
      unit: f.unit,
      function: f.function,
      kind: f.kind,
      anchor: f.anchor,
      description: f.description,
      target: f.target
        ? {
            file: f.target.file,
            originalLine: f.target.originalLine,
            currentLine: f.target.currentLine,
          }
        : undefined,
    })),
    staleIds: Array.from(session.staleIds),
    outOfSyncFiles: Array.from(session.outOfSyncFiles),
  };
}

/** Escape JSON so embedding inside `<script>` is safe. */
function serializeStateForScriptTag(state: unknown): string {
  return JSON.stringify(state)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildShell(
  webview: vscode.Webview,
  baseDir: string,
  session: VerificationSession
): string {
  const nonce = getNonce();
  const cssUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(baseDir, "css", "verificationReport.css"))
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(baseDir, "webviewScripts", "verificationReport.js"))
  );
  const cspSource = webview.cspSource;
  const initialState = toWireState(session);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}' ${cspSource};">
<title>Verify: ${escapeHtml(session.envName)}</title>
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<header>
  <h1>Verification Report</h1>
  <div id="meta" class="meta"></div>
  <button id="reverify-btn">Re-verify</button>
</header>
<div id="banner"></div>
<p id="summary"></p>
<div id="report-body"></div>
<script nonce="${nonce}">window.__reportState = ${serializeStateForScriptTag(initialState)};</script>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}
