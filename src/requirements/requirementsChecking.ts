import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";

import { REQS2CHECK_EXECUTABLE_PATH } from "./requirementsExecutables";
import { runReqs2xTool } from "./processRunner";
import { findRelevantRequirementGateway } from "./rgwPath";
import { logCliError } from "./requirementsLog";
import {
  applyVerificationDecorations,
  clearAllDecorations,
} from "./verificationDecorations";
import {
  closeVerificationReport,
  refreshVerificationReport,
  showVerificationReport,
  type VerificationSession,
} from "./verificationReport";

// Mirrors `autoreq.requirements_checking.checking.Finding`.
export interface Finding {
  kind: "violation" | "undocumented" | "missing";
  requirement_key: string | null;
  behavior_label: string | null;
  description: string;
}

export interface ReqsCheckFunctionEntry {
  function: string;
  unit: string;
  requirements: Array<{
    key: string;
    title?: string;
    description?: string;
  }>;
  findings: Finding[];
  finding_lines?: Array<{ file: string; line: number }>;
}

// `originalLine`/`originalText` are immutable snapshots from run time.
// `currentLine` follows the doc via edit-offset tracking (see
// `applyEditOffsets`), so decoration and click-jump targets stay
// visually correct as the user inserts/deletes lines above.
export interface VerificationFinding {
  id: string;
  unit: string;
  function: string;
  kind: Finding["kind"];
  anchor: string | null;
  description: string;
  target?: {
    file: string;
    originalLine: number;
    originalText: string;
    currentLine: number;
  };
}

let extensionContext: vscode.ExtensionContext | undefined;

const activeSessions = new Map<string, VerificationSession>();

export function activateRequirementsChecking(
  context: vscode.ExtensionContext
): void {
  extensionContext = context;

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      const fsPath = event.document.uri.fsPath;
      for (const session of activeSessions.values()) {
        const touches = session.findings.some(
          (f) => f.target && samePath(f.target.file, fsPath)
        );
        if (!touches) continue;

        recomputeStaleness(session, event.document, event.contentChanges);
        applyDecorationsForSession(session);
        refreshVerificationReport(session.enviroPath, session);
      }
    })
  );

  // Source-vs-build mtime drift only changes after a save (on-disk mtimes
  // don't move for in-memory edits).
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const fsPath = doc.uri.fsPath;
      for (const session of activeSessions.values()) {
        const touches = session.findings.some(
          (f) => f.target && samePath(f.target.file, fsPath)
        );
        if (!touches) continue;
        session.outOfSyncFiles = computeOutOfSyncFiles(session);
        applyDecorationsForSession(session);
        refreshVerificationReport(session.enviroPath, session);
      }
    })
  );
}

export async function clearCheckResults(enviroPath: string): Promise<void> {
  closeVerificationReport(enviroPath);
  activeSessions.delete(enviroPath);
  clearAllDecorations();
}

export async function checkRequirements(
  enviroPath: string,
  filter?: string | null,
  options?: { silent?: boolean }
): Promise<boolean> {
  if (!REQS2CHECK_EXECUTABLE_PATH) {
    if (!options?.silent) {
      vscode.window.showErrorMessage(
        "reqs2check binary is not available. Check your VectorCAST installation."
      );
    }
    return false;
  }

  const parentDir = path.dirname(enviroPath);
  const lowestDirname = path.basename(enviroPath);
  const envName = `${lowestDirname}.env`;
  const envPath = path.join(parentDir, envName);

  const gatewayPath = findRelevantRequirementGateway(enviroPath);
  if (!gatewayPath) {
    if (!options?.silent) {
      vscode.window.showErrorMessage(
        "No requirements gateway found. Generate or import requirements first."
      );
    }
    return false;
  }

  const args = [
    "-e",
    envPath,
    gatewayPath,
    "--json",
    "--json-events",
    ...(filter ? ["-f", filter] : []),
  ];

  let result;
  try {
    result = await runReqs2xTool({
      exe: REQS2CHECK_EXECUTABLE_PATH,
      args,
      llm: true,
      captureOutput: true,
      progress: {
        title: `Verifying ${envName.split(".")[0]}${
          filter ? ` (${filter})` : ""
        } against code`,
        logPrefix: "reqs2check",
      },
    });
  } catch (err) {
    const message = `reqs2check failed: ${
      err instanceof Error ? err.message : String(err)
    }`;
    if (!options?.silent) vscode.window.showErrorMessage(message);
    logCliError(message, !options?.silent);
    return false;
  }

  if (result.cancelled) return false;

  const entries = parseFindingsJson(result.stdout ?? "");
  if (entries === undefined) {
    if (!options?.silent) {
      vscode.window.showErrorMessage(
        "reqs2check finished but its JSON output could not be parsed. See the operations log."
      );
    }
    return false;
  }

  if (!extensionContext) return true;

  const findings = flattenFindings(entries);
  const session: VerificationSession = {
    enviroPath,
    envName: lowestDirname,
    ranAt: Date.now(),
    entries,
    findings,
    staleIds: new Set(),
    outOfSyncFiles: new Set(),
  };
  session.outOfSyncFiles = computeOutOfSyncFiles(session);
  activeSessions.set(enviroPath, session);

  applyDecorationsForSession(session);
  showVerificationReport(extensionContext, session, {
    onReverify: () => {
      void checkRequirements(enviroPath, filter, { silent: false });
    },
    onClose: () => {
      activeSessions.delete(enviroPath);
      clearAllDecorations();
    },
  });

  return true;
}

// Flatten finding entries into the per-finding shape used by the report
// and the decorations. Pins each finding to the first `finding_lines`
// target only — fanning out to every line would noise up the gutter.
function flattenFindings(
  entries: ReqsCheckFunctionEntry[]
): VerificationFinding[] {
  const out: VerificationFinding[] = [];
  for (const entry of entries) {
    if (!entry.findings || entry.findings.length === 0) continue;
    const targetMeta =
      entry.finding_lines && entry.finding_lines.length > 0
        ? entry.finding_lines[0]
        : undefined;
    const originalText = targetMeta
      ? readLineText(targetMeta.file, targetMeta.line)
      : undefined;

    entry.findings.forEach((finding, idx) => {
      out.push({
        id: `${entry.unit}::${entry.function}#${idx}`,
        unit: entry.unit,
        function: entry.function,
        kind: finding.kind,
        anchor: finding.requirement_key ?? finding.behavior_label ?? null,
        description: finding.description,
        target:
          targetMeta && originalText !== undefined
            ? {
                file: targetMeta.file,
                originalLine: targetMeta.line,
                originalText,
                currentLine: targetMeta.line,
              }
            : undefined,
      });
    });
  }
  return out;
}

// Trailing whitespace is stripped because such edits aren't meaningful
// enough to invalidate a finding.
function readLineText(file: string, line: number): string | undefined {
  try {
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    const candidate = lines[line - 1];
    return candidate === undefined ? undefined : candidate.replace(/\s+$/, "");
  } catch {
    return undefined;
  }
}

// Apply line-offset deltas from a doc-change event to every finding's
// `currentLine`. Findings whose original line is inside an edited range
// are marked stale outright; the rest shift by the net line-delta of all
// edits above them. Sorting changes by start position descending keeps
// each change's positions (which reference the old document) valid.
function applyEditOffsets(
  session: VerificationSession,
  fsPath: string,
  changes: readonly vscode.TextDocumentContentChangeEvent[]
): void {
  if (changes.length === 0) return;

  const sorted = [...changes].sort(
    (a, b) =>
      b.range.start.line - a.range.start.line ||
      b.range.start.character - a.range.start.character
  );

  for (const change of sorted) {
    const oldStart = change.range.start.line;
    const oldEnd = change.range.end.line;
    const newlines = (change.text.match(/\n/g) || []).length;
    const delta = newlines - (oldEnd - oldStart);

    for (const f of session.findings) {
      if (!f.target) continue;
      if (!samePath(f.target.file, fsPath)) continue;
      if (session.staleIds.has(f.id)) continue;

      const cur0 = f.target.currentLine - 1;
      if (cur0 < oldStart) continue;
      if (cur0 > oldEnd) {
        f.target.currentLine += delta;
      } else {
        session.staleIds.add(f.id);
      }
    }
  }
}

// Combine edit-offset tracking with a content sanity check at the
// updated line. Two findings on the same original line stay independent
// because each has its own `currentLine`.
function recomputeStaleness(
  session: VerificationSession,
  document: vscode.TextDocument,
  changes: readonly vscode.TextDocumentContentChangeEvent[]
): void {
  applyEditOffsets(session, document.uri.fsPath, changes);

  for (const f of session.findings) {
    if (!f.target) continue;
    if (!samePath(f.target.file, document.uri.fsPath)) continue;
    if (session.staleIds.has(f.id)) continue;

    const cur0 = f.target.currentLine - 1;
    if (cur0 < 0 || cur0 >= document.lineCount) {
      session.staleIds.add(f.id);
      continue;
    }
    const here = document.lineAt(cur0).text.replace(/\s+$/, "");
    if (here !== f.target.originalText) session.staleIds.add(f.id);
  }
}

function applyDecorationsForSession(session: VerificationSession): void {
  const live = session.findings.filter(
    (f) =>
      f.target &&
      !session.staleIds.has(f.id) &&
      !session.outOfSyncFiles.has(f.target.file)
  );
  applyVerificationDecorations(live);
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

// A source file is out-of-sync when its on-disk mtime is newer than the
// env's last build — line numbers from reqs2check (which mapped via the
// stored TU) no longer apply.
function computeOutOfSyncFiles(session: VerificationSession): Set<string> {
  const buildMs = envBuildMtime(session.enviroPath);
  if (buildMs === 0) return new Set();

  const out = new Set<string>();
  const files = new Set<string>();
  for (const f of session.findings) {
    if (f.target) files.add(f.target.file);
  }
  for (const file of files) {
    try {
      if (fs.statSync(file).mtimeMs > buildMs) out.add(file);
    } catch {
      // unreadable / missing — leave as in-sync; decoration logic will
      // skip it anyway when it can't read the file.
    }
  }
  return out;
}

// Best-effort env build mtime. VCAST writes COMMONDB.VCD and UUT_INTE.DAT
// on every build; either gets us the timestamp. Falls back to the env
// directory's mtime as a last resort.
function envBuildMtime(enviroPath: string): number {
  const candidates = [
    path.join(enviroPath, "COMMONDB.VCD"),
    path.join(enviroPath, "UUT_INTE.DAT"),
    enviroPath,
  ];
  for (const p of candidates) {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      // try next
    }
  }
  return 0;
}

// `reqs2check --json` writes the findings array on stdout after all the
// `--json-events` lines. Strip the single-line events and parse the rest.
function parseFindingsJson(
  raw: string
): ReqsCheckFunctionEntry[] | undefined {
  const remainder: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const json = JSON.parse(trimmed);
        if (json && typeof json === "object" && "event" in json) continue;
      } catch {
        // not an event; keep below
      }
    }
    remainder.push(line);
  }

  const candidate = remainder.join("\n").trim();
  if (!candidate) return [];
  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return undefined;
    return parsed as ReqsCheckFunctionEntry[];
  } catch (err) {
    logCliError(`reqs2check: could not parse JSON output: ${err}`);
    return undefined;
  }
}
