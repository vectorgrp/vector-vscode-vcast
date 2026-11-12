/// <reference path="./vscodeMcpApi.d.ts" />
import * as vscode from "vscode";
import { exeFilename } from "./utilities";
import { getVectorCastInstallationLocation } from "./vcastInstallation";

const fs = require("fs");
const path = require("path");

// VectorCAST installations that ship the MCP servers keep them next to clicast
const mcpServers = [
  { label: "VectorCAST", executable: "vcast-mcp-server" },
  { label: "VectorCAST Reqs2X", executable: "reqs2x-mcp-server" },
  { label: "VectorCAST Docs", executable: "docs-mcp-server" },
];

function installedMcpServers(vcastDir: string) {
  return mcpServers
    .map(({ label, executable }) => ({
      label,
      command: path.join(vcastDir, exeFilename(executable)),
    }))
    .filter(({ command }) => fs.existsSync(command));
}

function getMcpServerDefinitions(
  Definition: NonNullable<typeof vscode.McpStdioServerDefinition>
): vscode.McpStdioServerDefinition[] {
  const vcastDir = getVectorCastInstallationLocation();
  if (!vcastDir) return [];

  // A different VectorCAST build has a different tool version, which makes
  // VS Code replace the running servers with the new ones
  const toolVersion = fs
    .readFileSync(path.join(vcastDir, "DATA", "tool_version.txt"))
    .toString()
    .trim();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;

  return installedMcpServers(vcastDir).map(({ label, command }) => {
    const definition = new Definition(
      label,
      command,
      [],
      { VECTORCAST_DIR: vcastDir },
      toolVersion
    );
    definition.cwd = workspaceFolder;
    return definition;
  });
}

const updateHintShownKey = "mcpServersNeedNewerVsCodeShown";

// Only once, so that people who stay on an older VS Code are not told again
// on every start
function suggestUpdatingVsCode(context: vscode.ExtensionContext) {
  if (context.globalState.get(updateHintShownKey)) return;
  const vcastDir = getVectorCastInstallationLocation();
  if (!vcastDir || installedMcpServers(vcastDir).length === 0) return;

  void context.globalState.update(updateHintShownKey, true);
  void vscode.window.showInformationMessage(
    "This VectorCAST installation includes MCP servers. Update VS Code to 1.101 or newer to use them in chat automatically."
  );
}

export function registerMcpServers(context: vscode.ExtensionContext) {
  // VS Code before 1.101 has no MCP API; the rest of the extension works without it
  const lm = vscode.lm;
  const Definition = vscode.McpStdioServerDefinition;
  if (!lm?.registerMcpServerDefinitionProvider || !Definition) {
    suggestUpdatingVsCode(context);
    return;
  }

  const definitionsChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(
    definitionsChanged,
    lm.registerMcpServerDefinitionProvider("vectorcast", {
      onDidChangeMcpServerDefinitions: definitionsChanged.event,
      provideMcpServerDefinitions: () => getMcpServerDefinitions(Definition),
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(
          "vectorcastTestExplorer.vectorcastInstallationLocation"
        )
      ) {
        definitionsChanged.fire();
      }
    })
  );
}
