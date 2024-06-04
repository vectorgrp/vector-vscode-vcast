import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionParams,
} from "vscode-languageserver";
import { Hover } from "vscode-languageserver-types";

import { getCodedTestCompletionData } from "./ctCompletions";
import { validateTextDocument } from "./tstValidation";
import { getTstCompletionData } from "./tstCompletion";
import { getHoverString } from "./tstHover";

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

let testFiletoEnviroMap: Map<string, string> = new Map<string, string>();

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
  // initializePython(); - this was called with if(false) inside
  return {
    capabilities: {
      textDocumentSync: documents.syncKind,
      hoverProvider: true,
      // Tell the client that the server supports code completion
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ["\n", ":", ".", ",", "(", "="],
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
      connection.console.log("Workspace folder change event received.");
    });
  }
});

// this handler receives information about coded test file to environment association
// so that we know what environment to use wheen providing LSE features for coded test file
// The data parameter is a JSON object with two fields: filePath and enviroPath
connection.onNotification("vcasttesteditor/loadTestfile", (data) => {
  testFiletoEnviroMap.set(data.filePath, data.enviroPath);
  connection.console.log(
    "Load test file: " +
      data.filePath +
      " notification for environment: " +
      data.enviroPath
  );
});

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log("We received a file change event");
});

// The content of a text document has changed. This event is emitted
// when the text document is first opened or when its content has changed.
documents.onDidChangeContent((change) => {
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

connection.onCompletion(
  (completionData: CompletionParams): CompletionItem[] => {
    if (completionData.textDocument.uri.endsWith(".tst")) {
      return getTstCompletionData(documents, completionData);
    } else {
      const filePath = url.fileURLToPath(completionData.textDocument.uri);
      const enviroPath = testFiletoEnviroMap.get(filePath);
      if (enviroPath) {
        return getCodedTestCompletionData(
          documents,
          enviroPath,
          completionData
        );
      } else {
        return [];
      }
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
    const hoverString = getHoverString(documents, completionData);
    var hover: Hover = { contents: hoverString };
    return hover;
  } else {
    return undefined;
  }
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
