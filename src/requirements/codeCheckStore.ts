import * as vscode from "vscode";
import { EnvironmentCheck } from "./codeCheckData";

const STATE_KEY = "vectorcastTestExplorer.codeChecks";

/**
 * The checks of the code against the requirements, by environment path. Kept
 * in the workspace state, so the findings are still there after a reload.
 * Everything that shows them (the comments in the code, the report, the
 * requirements editor) listens to `onDidChange` and shows what `get` returns.
 */
export class CodeCheckStore {
  private readonly checks: Record<string, EnvironmentCheck>;
  private readonly changed = new vscode.EventEmitter<string>();

  /** Fires with the path of the environment whose check changed. */
  readonly onDidChange = this.changed.event;

  constructor(private readonly state: vscode.Memento) {
    this.checks = state.get<Record<string, EnvironmentCheck>>(STATE_KEY, {});
  }

  get environments(): string[] {
    return Object.keys(this.checks);
  }

  get(enviroPath: string): EnvironmentCheck | undefined {
    return this.checks[enviroPath];
  }

  set(enviroPath: string, check: EnvironmentCheck | undefined): void {
    if (check) this.checks[enviroPath] = check;
    else delete this.checks[enviroPath];
    void this.state.update(STATE_KEY, this.checks);
    this.changed.fire(enviroPath);
  }
}
