// this file contains the language server client logic for test script editing

import * as path from "path";
import { ExtensionContext } from "vscode";

import { globalEnviroServerActive } from "./vcastAdapter";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient";

import { vectorMessage } from "./messagePane";

import { vPythonCommandToUse } from "./vcastInstallation";

let client: LanguageClient;

export function activateLanguageServerClient(context: ExtensionContext) {
  // The server is implemented in nodejs also
  let serverModule = context.asAbsolutePath(path.join("out", "server.js"));

  // The debug options for the server
  // --inspect=6009: runs the tserver in Node's Inspector mode so VS Code can attach to the server for debugging
  let debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const vpythonPath: string =
    vPythonCommandToUse != null ? vPythonCommandToUse : "vpython";
  let serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      args: [
        context.asAbsolutePath("."),
        vpythonPath,
        globalEnviroServerActive.toString(),
      ],
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      args: [context.asAbsolutePath("."), vpythonPath],
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", pattern: "**/*.tst" }],
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    "vcasttesteditor",
    "VectorCAST Test Editor",
    serverOptions,
    clientOptions
  );

  // Start the client. This will also launch the server
  vectorMessage(
    "Starting the language server client for test script editing ..."
  );
  client.start();
}

export function deactivateLanguageServerClient(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
