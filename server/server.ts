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

import { initializePaths } from "./pythonUtilities";
import { getTstCompletionData } from "./tstCompletion";
import { getHoverString } from "./tstHover";
import { validateTextDocument } from "./tstValidation";

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {

  // reads the params passed to the server 
  // and initializes globals for vpyton path etc.
  initializePaths (
    process.argv[2],  // extensionRoot
    process.argv[3],  // vpythonPath
  );

  return {
    capabilities: {
      textDocumentSync: documents.syncKind,
      hoverProvider: true,
      // Tell the client that the server supports code completion
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ["\n", ":", ".", ","],
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

connection.onDidChangeWatchedFiles((_change) => {
  // Monitored files have change in VSCode
  connection.console.log("We received a file change event");
});

// The content of a text document has changed. This event is emitted
// when the text document is first opened or when its content has changed.
documents.onDidChangeContent((change) => {
  // Improvement needed:  Is it ok if this is called before the previous validation is complete?

  let diagnostics = validateTextDocument(change.document);
  // Send the computed diagnostics to VSCode.
  connection.sendDiagnostics({ uri: change.document.uri, diagnostics });
});

// This handler gets called whenever "completion" is triggered by
// the characters in the "triggerCharacters" array that onInitialize sets

connection.onCompletion(
  async (completionData: CompletionParams): Promise<CompletionItem[]> => {
    return await getTstCompletionData(documents, completionData);
  }
);

// This handler gets called AFTER the user selects something from the current completion list
// It seems that this gets called even when the user does up and down arrow not just a selection
// maybe this is for us to provide "extra" info for that choice?
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  return item;
});

connection.onHover(
  async (completionData: CompletionParams): Promise <Hover | undefined> => {
    // This function gets called when the user hovers over a line section
    const hoverString = await getHoverString(documents, completionData);

    var hover: Hover = { contents: hoverString };
    return hover;
  }
);

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
