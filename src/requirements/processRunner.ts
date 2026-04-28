import * as vscode from "vscode";
import {
  ChildProcessWithoutNullStreams,
  spawn,
} from "node:child_process";
import { logCliError, logCliOperation } from "./requirementsLog";
import { spawnWithVcastEnv } from "./llmProvider";

/**
 * Parses Reqs2X tool stdout for `--json-events` lines and drives a VS Code
 * progress reporter from them. Plain (non-JSON) lines are forwarded to the
 * operations output channel verbatim.
 */
export class ProgressTracker {
  private lastProgress = 0.0;

  constructor(
    private progress: vscode.Progress<{ message?: string; increment?: number }>,
    private logPrefix: string
  ) {}

  public processOutput(output: string) {
    const lines = output.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        this.handleJson(json);
      } catch {
        logCliOperation(`${this.logPrefix}: ${line}`);
      }
    }
  }

  private handleJson(json: any) {
    if (!json.event) {
      throw new Error(
        `Invalid JSON event: ${JSON.stringify(json)}. Missing 'event' field.`
      );
    }
    if (!json.value) {
      throw new Error(
        `Invalid JSON event: ${JSON.stringify(json)}. Missing 'value' field.`
      );
    }
    if (json.event === "progress") {
      let step: string | undefined;
      let newProgress: number | undefined;
      if (typeof json.value === "object") {
        step = json.value.step;
        newProgress = json.value.progress;
      } else if (typeof json.value === "number") {
        newProgress = json.value; // legacy
      }

      if (newProgress === undefined) return;

      const increment = (newProgress - this.lastProgress) * 100;
      if (increment > 0) {
        this.progress.report({ message: step, increment });
        this.lastProgress = newProgress;
        logCliOperation(
          `${this.logPrefix} Progress: ${(newProgress * 100).toFixed(2)}% - ${step ?? ""}`
        );
      }
    } else if (json.event === "problem") {
      if (this.logPrefix === "reqs2tests" && json.value.includes("Individual")) {
        return;
      }
      vscode.window.showWarningMessage(json.value);
      logCliOperation(`Warning: ${json.value}`);
    }
  }
}

export interface RunReqs2xToolOptions {
  /** Absolute path to the executable (panreq, code2reqs, reqs2tests, etc.). */
  exe: string;
  /** Arguments. */
  args: string[];
  /** Optional working directory. */
  cwd?: string;
  /**
   * If true, the tool needs the LLM-aware env block (provider check + env
   * vars). Use for code2reqs, reqs2tests, panreq --infer-traceability.
   * Skip for plain panreq format conversions or other LLM-free operations.
   */
  llm?: boolean;
  /**
   * If provided, wraps the run in a VS Code progress notification and parses
   * the tool's stdout via ProgressTracker. The notification is cancellable —
   * cancel kills the subprocess and the runner returns `{ cancelled: true }`.
   */
  progress?: { title: string; logPrefix: string };
}

export interface RunReqs2xToolResult {
  cancelled: boolean;
}

/**
 * Single entry point for invoking a Reqs2X CLI tool. Replaces the previous
 * mix of `spawnAndWait`, ad-hoc `spawn(...)` blocks, and inline progress
 * wiring scattered across the requirements modules.
 *
 * - Logs the command, stdout, stderr and exit code to the operations output.
 * - Honors `llm` to decide between plain `spawn` and LLM-checked
 *   `spawnWithVcastEnv`.
 * - With `progress` set, drives the standard notification + cancel button.
 *
 * Resolves on success, throws on non-zero exit, or returns
 * `{ cancelled: true }` if the user cancelled a progress run.
 */
export async function runReqs2xTool(
  opts: RunReqs2xToolOptions
): Promise<RunReqs2xToolResult> {
  logCliOperation(
    `Running: ${opts.exe} ${opts.args.join(" ")}${opts.cwd ? `  (cwd=${opts.cwd})` : ""}`
  );

  const spawnOpts = opts.cwd ? { cwd: opts.cwd } : {};
  const startProc = async (): Promise<ChildProcessWithoutNullStreams> =>
    opts.llm
      ? await spawnWithVcastEnv(opts.exe, opts.args, spawnOpts)
      : spawn(opts.exe, opts.args, spawnOpts);

  if (opts.progress) {
    const progressOpts = opts.progress;
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: progressOpts.title,
        cancellable: true,
      },
      async (progress, cancellationToken) => {
        const proc = await startProc();
        const tracker = new ProgressTracker(progress, progressOpts.logPrefix);

        let cancelled = false;
        cancellationToken.onCancellationRequested(() => {
          cancelled = true;
          proc.kill();
          logCliOperation(`${progressOpts.logPrefix}: cancelled by user`);
        });

        await new Promise<void>((resolve, reject) => {
          proc.stdout.on("data", (d) => {
            if (!cancelled) tracker.processOutput(d.toString());
          });
          proc.stderr.on("data", (d) => {
            const errOut = d.toString();
            if (errOut.trim()) logCliError(`${progressOpts.logPrefix}: ${errOut.trim()}`);
          });
          proc.on("error", reject);
          proc.on("close", (code) => {
            logCliOperation(`${progressOpts.logPrefix} exit code: ${code}`);
            if (cancelled) return resolve();
            if (code === 0) resolve();
            else reject(new Error(`${progressOpts.logPrefix} exited with code ${code}`));
          });
        });

        return { cancelled };
      }
    );
  }

  // No progress notification: capture both streams and log them.
  const proc = await startProc();
  let stdout = "";
  let stderr = "";

  await new Promise<void>((resolve, reject) => {
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (stdout.trim()) logCliOperation(`stdout: ${stdout.trim()}`);
      if (stderr.trim()) logCliOperation(`stderr: ${stderr.trim()}`);
      logCliOperation(`exit code: ${code}`);
      if (code === 0) resolve();
      else reject(new Error(`${opts.exe} exited with code ${code}: ${stderr}`));
    });
  });

  return { cancelled: false };
}
