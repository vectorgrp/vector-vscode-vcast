import * as vscode from "vscode";

// Output channel for all Reqs2X CLI invocations (code2reqs, reqs2tests,
// panreq, llm2check). Lives in a leaf module so every other requirements
// module can import the log helpers without pulling in requirementsOperations
// — the dependency that previously forced lazy `require()` calls.
const cliOutputChannel: vscode.OutputChannel = vscode.window.createOutputChannel(
  "VectorCAST Requirement Test Generation Operations"
);

export function logCliOperation(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  cliOutputChannel.appendLine(`[${timestamp}] ${message}`);
}

export function logCliError(
  message: string,
  show: boolean | null = null
): void {
  const timestamp = new Date().toLocaleTimeString();
  cliOutputChannel.appendLine(`[${timestamp}] ${message}`);
  if (show) {
    cliOutputChannel.show();
  }
}
