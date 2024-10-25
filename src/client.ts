// this file contains the language server client logic for test script editing

import * as path from "path";
import { ExtensionContext } from "vscode";

import { globalEnviroDataServerActive } from "../src-common/vcastServer";

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient";

import { enviroDataType } from "../src-common/commonUtilities";
import { vectorMessage } from "./messagePane";
import { vPythonCommandToUse } from "./vcastInstallation";

let client: LanguageClient;
let globalvMockAvailable: boolean = false;
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
        globalEnviroDataServerActive.toString(),
      ],
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      args: [
        context.asAbsolutePath("."),
        vpythonPath,
        globalEnviroDataServerActive.toString(),
      ],
      transport: TransportKind.ipc,
      options: debugOptions,
    },
  };

  // Options to control the language client
  // we register for .tst and c|cpp files, and do the right thing in the callback
  // depending on the extension of the file
  let clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", pattern: "**/*.tst" },
      { scheme: "file", language: "c" },
      { scheme: "file", language: "cpp" },
      { scheme: "file", language: "cuda-cpp" },
    ],
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

  // initialize the vMock status to the value set during activation
  updateVMockStatus(globalvMockAvailable);
}

// we keep a cache of what we have sent to the server so we don't
// constantly send the same pair, we intentionally over-write the
// file path key if it already exists, since the most recent
// environment association is the most correct.

let testFilesSentToServer: Map<string, enviroDataType> = new Map();

function shouldSendFileInfoToServer(
  testFilePath: string,
  enviroPath: string,
  enviroHasMockSupport: boolean
) {
  // we only want to send the file association data to the server
  // if we have not sent it before, or if something has changed
  // like the environment path or the mock support status
  const enviroData = testFilesSentToServer.get(testFilePath);
  if (enviroData) {
    if (
      enviroData.enviroPath == enviroPath &&
      enviroData.hasMockSupport == enviroHasMockSupport
    ) {
      return false;
    } else {
      return true;
    }
  } else {
    return true;
  }
}

// This function is used to send the server information about the association between
// a coded test file and the environment that uses that file.
export function sendTestFileDataToLanguageServer(
  testFilePath: string,
  enviroPath: string,
  enviroHasMockSupport: boolean
) {
  // if this test file is in the map for this environment, return
  if (
    shouldSendFileInfoToServer(testFilePath, enviroPath, enviroHasMockSupport)
  ) {
    // else this is a new test file or a new enviro for an existing test file
    // we always send in in the second case, because we want the server
    // to have the latest association.
    client.onReady().then(() => {
      testFilesSentToServer.set(testFilePath, {
        enviroPath: enviroPath,
        hasMockSupport: enviroHasMockSupport,
      });
      // we want the server to know about all test files, because this
      // allows the server to give helpful error messages when the
      // enviro does not support mocks.
      client.sendNotification("vcasttesteditor/loadTestfile", {
        testFilePath,
        enviroPath,
        enviroHasMockSupport,
      });
    });
  }
}

// This function is used to update vmockAvailable on the server side
export function updateVMockStatus(vmockAvailable: boolean) {
  // during activation, the client may not be ready yet, so we store the value
  // of the vmockAvailable flag in a global variable and send it to the server
  // on startup
  if (client) {
    client.onReady().then(() => {
      client.sendNotification("vcasttesteditor/vmockstatus", {
        vmockAvailable,
      });
    });
  } else {
    globalvMockAvailable = vmockAvailable;
  }
}

// This function is used to send an updated path to vPython to the server
export function sendVPythonCommandToServer(vPythonCommand: string) {
  if (client) {
    client.onReady().then(() => {
      client.sendNotification("vcasttesteditor/updateVPythonCommand", {
        vPythonCommand,
      });
    });
  }
}

// This function is used to send an updated state of the
// enviro data server to the language server
export function sendServerStateToLanguageServer(useServer: boolean) {
  if (client) {
    client.onReady().then(() => {
      client.sendNotification("vcasttesteditor/updateServerState", {
        useServer,
      });
    });
  }
}

export function deactivateLanguageServerClient(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
