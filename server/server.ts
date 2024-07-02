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

import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver-types";

import { getCodedTestCompletionData, vmockStubRegex } from "./ctCompletions";
import { updateVPythonCommand } from "./pythonUtilities";
import { getLineFragment } from "./serverUtilities";
import { getDiagnosticObject, validateTextDocument } from "./tstValidation";
import { getTstCompletionData } from "./tstCompletion";
import { getHoverString } from "./tstHover";

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

interface enviroDataType {
  enviroPath: string;
  hasMockSupport: boolean;
}

let testFileToEnviroMap: Map<string, enviroDataType> = new Map();

let globalVMockAvailable: boolean = false;

// Create a simple text document manager. The text document manager
// supports full document sync only
let textDocumentManager: TextDocuments = new TextDocuments();

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
  // initializePython(); - this was called with if(false) inside
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

function generateCodedTestDiagnostic(documentUri: string, lineNumber: number) {
  // When we have a coded test file for an environment that does
  // not have mock support, we give the user a helpful diagnostic message
  let diagnostic: Diagnostic = getDiagnosticObject(
    lineNumber,
    0,
    1000,
    "This environment does not support mocks, no auto-completion is available",
    DiagnosticSeverity.Warning
  );
  connection.sendDiagnostics({
    uri: documentUri,
    diagnostics: [diagnostic],
  });
}

function clearCodedTestDiagnostics (documentUri: string) {
  connection.sendDiagnostics({
    uri: documentUri,
    diagnostics: []
  });
}


function performCompletionProcessing(
  currentDocument: TextDocument,
  completionData: CompletionParams
): CompletionItem[] {
  // Test Script Editor
  if (completionData.textDocument.uri.endsWith(".tst")) {
    return getTstCompletionData(currentDocument, completionData);

    // Coded Test Editor
  } else if (globalVMockAvailable) {
    const filePath = url.fileURLToPath(completionData.textDocument.uri);
    const enviroData: enviroDataType | undefined =
      testFileToEnviroMap.get(filePath);

    // if this file is a coded test file associated with an environment
    if (enviroData && enviroData.enviroPath) {
      const lineSoFar: string = getLineFragment(
        currentDocument,
        completionData.position
      ).trimEnd();

      if (enviroData.hasMockSupport) {
        return getCodedTestCompletionData(
          lineSoFar,
          completionData,
          enviroData.enviroPath
        );
      } else if (vmockStubRegex.test(lineSoFar)) {
        // else the environment does not support mocks, and the user
        // typed a "// vmock" comment, so we help out with a diagnostic
        generateCodedTestDiagnostic(
          completionData.textDocument.uri,
          completionData.position.line
        );
      }else {
        // clear any left over diagnostics.
        // We don't need to keep these on every line where the user 
        // types // vmock, so this will clear the previous message
        // when the user types anything else.
        clearCodedTestDiagnostics (completionData.textDocument.uri);
      } // coded test file for enviro without mock support
    } // not a coded test file
  } // vcast does not support mocking
  return [];
}

connection.onCompletion(
  (completionData: CompletionParams): CompletionItem[] => {
    const currentDocument = textDocumentManager.get(
      completionData.textDocument.uri
    );
    if (currentDocument) {
      return performCompletionProcessing(currentDocument, completionData);
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

connection.onHover((completionData: CompletionParams): Hover | undefined => {
  // This function gets called when the user hovers over a line section
  if (completionData.textDocument.uri.endsWith(".tst")) {
    const hoverString = getHoverString(textDocumentManager, completionData);
    var hover: Hover = { contents: hoverString };
    return hover;
  } else {
    return undefined;
  }
});

// Make the text document manager listen on the connection
// for open, change and close text document events
textDocumentManager.listen(connection);

// Listen on the connection
connection.listen();
