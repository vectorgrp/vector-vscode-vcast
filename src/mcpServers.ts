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

  const definitions: vscode.McpStdioServerDefinition[] = [];
  for (const { label, executable } of mcpServers) {
    const command = path.join(vcastDir, exeFilename(executable));
    if (!fs.existsSync(command)) continue;
    const definition = new Definition(
      label,
      command,
      [],
      { VECTORCAST_DIR: vcastDir },
      toolVersion
    );
    definition.cwd = workspaceFolder;
    definitions.push(definition);
  }
  return definitions;
}

export function registerMcpServers(context: vscode.ExtensionContext) {
  // VS Code before 1.101 has no MCP API; the rest of the extension works without it
  const lm = vscode.lm;
  const Definition = vscode.McpStdioServerDefinition;
  if (!lm?.registerMcpServerDefinitionProvider || !Definition) return;

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
