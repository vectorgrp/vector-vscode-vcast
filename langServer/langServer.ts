import {
  CompletionItem,
  CompletionParams,
  createConnection,
  DidChangeConfigurationNotification,
  InitializeParams,
  ProposedFeatures,
  TextDocument,
  TextDocuments,
} from "vscode-languageserver";

import { Hover } from "vscode-languageserver-types";

import { enviroDataType } from "../src-common/commonUtilities";
import { setGLobalServerState, setServerPort } from "../src-common/vcastServer";

import { getCodedTestCompletionData, vmockStubRegex } from "./ctCompletions";

import {
  generateDiagnosticForTest,
  initializePaths,
  updateVPythonCommand,
  updateClicastCommandForLanguageServer,
} from "./pythonUtilities";

import {
  buildCompletionList,
  convertKind,
  getLineFragment,
} from "./serverUtilities";

import { getTstCompletionData } from "./tstCompletion";
import { getHoverString } from "./tstHover";
import { validateTextDocument } from "./tstValidation";

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

let testFileToEnviroMap: Map<string, enviroDataType> = new Map();

let globalVMockAvailable: boolean = false;

// Create a simple text document manager. The text document manager
// supports full document sync only
let textDocumentManager: TextDocuments = new TextDocuments();

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
  // reads the params passed to the server
  // and initializes globals for vpyton path etc.
  initializePaths(
    process.argv[2], // extensionRoot
    process.argv[3], // vpythonPath
    process.argv[4].toLowerCase() === "true" // useServer
  );

  return {
    capabilities: {
      textDocumentSync: textDocumentManager.syncKind,
      hoverProvider: true,
      // Tell the client that the server supports code completion
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ["\n", ":", ".", ",", " ", "="],
      },
    },
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Notification received: workspace folder change");
    });
  }
});

// this handler receives information about coded test file to environment association
// so that we know what environment to use wheen providing LSE features for coded test file
// The data parameter is a JSON object with two fields: filePath and enviroPath
connection.onNotification("vcasttesteditor/loadTestfile", (data) => {
  const testFileData: enviroDataType = {
    enviroPath: data.enviroPath,
    hasMockSupport: data.enviroHasMockSupport,
  };

  testFileToEnviroMap.set(data.testFilePath, testFileData);
  connection.console.log(
    "Notification received: test file: " +
      data.testFilePath +
      " environment: " +
      data.enviroPath +
      " supports mocks: " +
      data.enviroHasMockSupport
  );
});

// this handler is called with the status of vmock available, it will be called on
// initialization and whenever the vcast installation changes
connection.onNotification("vcasttesteditor/vmockstatus", (data) => {
  globalVMockAvailable = data.vmockAvailable;
  connection.console.log(
    "Notification received: vMock Available: " + data.vmockAvailable
  );
});

connection.onNotification("vcasttesteditor/updateVPythonCommand", (data) => {
  updateVPythonCommand(data.vPythonCommand);
  connection.console.log(
    "Notification received: vPython Path: " + data.vPythonCommand
  );
});

connection.onNotification("vcasttesteditor/updateClicastCommand", (data) => {
  updateClicastCommandForLanguageServer(data.clicastCommand);
  connection.console.log(
    "Notification received: Clicast Command: " + data.clicastCommand
  );
});

connection.onNotification("vcasttesteditor/updateServerPort", (data) => {
  setServerPort(data.portNumber);
  connection.console.log(
    "Notification received: vectorcast data server port: " + data.portNumber
  );
});

connection.onNotification("vcasttesteditor/updateServerState", (data) => {
  setGLobalServerState(data.useServer);
  connection.console.log(
    "Notification received: use vectorcast data server: " + data.useServer
  );
});

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log("Notification received: file change event");
});

// The content of a text document has changed. This event is emitted
// when the text document is first opened or when its content has changed.
textDocumentManager.onDidChangeContent((change) => {
  // Improvement needed:  Is it ok if this is called before the previous validation is complete?

  if (change.document.uri.endsWith(".tst")) {
    let diagnostics = validateTextDocument(change.document);
    // Send the computed diagnostics to VSCode.
    connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
  }
});

// This handler gets called whenever "completion" is triggered by
// the characters in the "triggerCharacters" array that onInitialize sets

import url = require("url");

function clearCodedTestDiagnostics(documentUri: string) {
  connection.sendDiagnostics({
    uri: documentUri,
    diagnostics: [],
  });
}

async function performCompletionProcessing(
  currentDocument: TextDocument,
  completionData: CompletionParams
): Promise<CompletionItem[]> {
  // Test Script Editor
  if (completionData.textDocument.uri.endsWith(".tst")) {
    const returnData = await getTstCompletionData(
      currentDocument,
      completionData
    );
    if (
      returnData.extraText == "migration-error" ||
      returnData.extraText == "server-error"
    ) {
      // If we get a migration or server error, we let the user
      // know by generating a diagnostic message in the editor
      generateDiagnosticForTest(
        connection,
        returnData.messages[0],
        completionData.textDocument.uri,
        completionData.position.line
      );
    }

    return buildCompletionList(
      returnData.choiceList,
      convertKind(returnData.choiceKind)
    );
  } else {
    // not a test script file check if its coded test file
    const filePath = url.fileURLToPath(completionData.textDocument.uri);
    const enviroData: enviroDataType | undefined =
      testFileToEnviroMap.get(filePath);

    // if this file is a coded test file associated with an environment
    if (enviroData && enviroData.enviroPath) {
      //
      // clear any left over diagnostics.
      // We don't need to keep these on every line where the user
      // types // vmock, so this will clear the previous message
      // when the user types anything else.
      clearCodedTestDiagnostics(completionData.textDocument.uri);

      // check what the user has typed
      const lineSoFar: string = getLineFragment(
        currentDocument,
        completionData.position
      ).trimEnd();

      // The only auto-complete we do is for when the user has
      // typed on a line that starts with "// vmock" comment ...
      if (vmockStubRegex.test(lineSoFar)) {
        // we have a line that we would normally process
        // if our VectorCAST version supports mocks ...
        if (globalVMockAvailable) {
          if (enviroData.hasMockSupport) {
            return getCodedTestCompletionData(
              connection,
              lineSoFar,
              completionData,
              enviroData.enviroPath
            );
          } else {
            // else the environment does not support mocks
            // help out with a diagnostic message in the editor
            generateDiagnosticForTest(
              connection,
              "This environment does not support mocks, no auto-completion is available.\nRebuild the environment to use mocks    ",
              completionData.textDocument.uri,
              completionData.position.line
            );
            return [];
          }
        } else {
          // else the VectorCAST version does not support mocks
          // help out with a diagnostic message in the editor
          generateDiagnosticForTest(
            connection,
            "This currently configured version of VectorCAST does not support mocks.\nUpdate to version 24-SP4 or later to use mocks",
            completionData.textDocument.uri,
            completionData.position.line
          );
          return [];
        }
      } else {
        // not a line we care about
        return [];
      }
    } else {
      // not a coded test file, so we do nothing
      return [];
    }
  }
}

connection.onCompletion(
  async (completionData: CompletionParams): Promise<CompletionItem[]> => {
    const currentDocument = textDocumentManager.get(
      completionData.textDocument.uri
    );
    if (currentDocument) {
      return await performCompletionProcessing(currentDocument, completionData);
    } else {
      // no text document, do nothing
      return [];
    }
  }
);

// This handler gets called AFTER the user selects something from the current completion list
// It seems that this gets called even when the user does up and down arrow not just a selection
// maybe this is for us to provide "extra" info for that choice?
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  return item;
});

connection.onHover(
  async (completionData: CompletionParams): Promise<Hover | undefined> => {
    // This function gets called when the user hovers over a line section
    if (completionData.textDocument.uri.endsWith(".tst")) {
      const hoverString = await getHoverString(
        textDocumentManager,
        completionData
      );
      const hover: Hover = { contents: hoverString };
      return hover;
    } else {
      return undefined;
    }
  }
);

// Make the text document manager listen on the connection
// for open, change and close text document events
textDocumentManager.listen(connection);

// Listen on the connection
connection.listen();
