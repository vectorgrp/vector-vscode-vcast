// VS Code's MCP server API arrived in 1.101, but the extension still supports
// VS Code 1.79, so it compiles against @types/vscode 1.79.0: that way the
// compiler rejects any newer API used without a check. These are the parts of
// the 1.101 API that mcpServers.ts uses, declared as possibly missing so that
// it must check for them. Keep @types/vscode at 1.79.0, since newer typings
// declare the same names.
import "vscode";

declare module "vscode" {
  export interface McpStdioServerDefinition {
    readonly label: string;
    cwd?: Uri;
    command: string;
    args: string[];
    env: Record<string, string | number | null>;
    version?: string;
  }

  export const McpStdioServerDefinition:
    | (new (
        label: string,
        command: string,
        args?: string[],
        env?: Record<string, string | number | null>,
        version?: string
      ) => McpStdioServerDefinition)
    | undefined;

  export interface McpServerDefinitionProvider {
    readonly onDidChangeMcpServerDefinitions?: Event<void>;
    provideMcpServerDefinitions(
      token: CancellationToken
    ): ProviderResult<McpStdioServerDefinition[]>;
  }

  export const lm:
    | {
        registerMcpServerDefinitionProvider?(
          id: string,
          provider: McpServerDefinitionProvider
        ): Disposable;
      }
    | undefined;
}
