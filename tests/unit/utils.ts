import {
  TextDocument,
  TextDocuments,
  type Diagnostic,
} from "vscode-languageserver";
import { CompletionTriggerKind } from "vscode-languageserver-protocol";
import URI from "vscode-uri";
import { getHoverString } from "../../server/tstHover";
import { setPaths } from "../../server/pythonUtilities";
import { getTstCompletionData } from "../../server/tstCompletion";
import { validateTextDocument } from "../../server/tstValidation";

import path from "node:path";
import process from "node:process";

export type HoverPosition = {
  line: number;
  character: number;
};

export function generateHoverData(
  tstText: string,
  position: HoverPosition,
  envName?: string,
  emptyDocument?: boolean
) {
  envName ||= "vcast";

  const languageId = "VectorCAST Test Script";
  const testEnvPath = path.join(
    process.env.PACKAGE_PATH as string,
    "tests",
    "unit",
    envName
  );
  const tstFilepath = path.join(
    testEnvPath,
    process.env.TST_FILENAME as string
  );
  const uri = URI.file(tstFilepath).toString();

  const textDocument = TextDocument.create(uri, languageId, 1, tstText);
  const documents = new TextDocuments();

  /* Private access to store new document */
  documents._documents[uri] = emptyDocument ? undefined : textDocument;

  const completion = asHoverParameters(textDocument, position);

  setPaths(
    path.join(
      process.env.PACKAGE_PATH as string,
      "python",
      "testEditorInterface.py"
    ),
    "vpython"
  );

  if (documents.all()?.[0]) {
    console.log(`Input .tst script: \n ${documents.all()[0].getText()} \n`);
  }

  return getHoverString(documents, completion);
}

export function asHoverParameters(
  textDocument: TextDocument,
  position: HoverPosition
) {
  return {
    textDocument,
    position: { line: position.line, character: position.character },
  };
}

export function getHoverPositionForLine(
  lineToHoverOver: string,
  tstFileText: string,
  hoverSubstring: string
): HoverPosition {
  const linesInTst = tstFileText.split("\n");
  const lineNumber = linesInTst.indexOf(lineToHoverOver, 0);
  const columnNumber = lineToHoverOver.indexOf(hoverSubstring);
  return { line: lineNumber, character: columnNumber };
}

export type CompletionPosition = {
  line: number;
  character: number;
};

// eslint-disable-next-line max-params
export function generateCompletionData(
  tstText: string,
  position: CompletionPosition,
  triggerCharacter: string | undefined,
  envName?: string,
  emptyDocument?: boolean
) {
  envName ||= "vcast";
  const languageId = "VectorCAST Test Script";
  const testEnvPath = path.join(
    process.env.PACKAGE_PATH as string,
    "tests",
    "unit",
    envName
  );
  const tstFilepath = path.join(
    testEnvPath,
    process.env.TST_FILENAME as string
  );
  const uri = URI.file(tstFilepath).toString();

  const textDocument = TextDocument.create(uri, languageId, 1, tstText);
  const documents = new TextDocuments();

  /* Private access to store new document */
  documents._documents[uri] = emptyDocument ? undefined : textDocument;

  const completion = asCompletionParameters(
    textDocument,
    position,
    triggerCharacter
  );
  setPaths(
    path.join(
      process.env.PACKAGE_PATH as string,
      "python",
      "testEditorInterface.py"
    ),
    "vpython"
  );

  if (documents.all()?.[0]) {
    console.log(`Input .tst script: \n ${documents.all()[0].getText()} \n`);
  }

  return getTstCompletionData(documents, completion);
}

export function asCompletionParameters(
  textDocument: TextDocument,
  position: CompletionPosition,
  triggerCharacter: string | undefined
) {
  return {
    textDocument,
    position: { line: position.line, character: position.character },
    context: {
      triggerKind: CompletionTriggerKind.TriggerCharacter,
      triggerCharacter,
    },
  };
}

export function getCompletionPositionForLine(
  lineToComplete: string,
  tstFileText: string
): CompletionPosition {
  const linesInTst = tstFileText.split("\n");
  const lineNumber = linesInTst.indexOf(lineToComplete, 0);
  const columnNumber = lineToComplete.length;
  return { line: lineNumber, character: columnNumber };
}

export function generateDiagnosticMessages(tstText: string): string[] {
  const languageId = "VectorCAST Test Script";
  const testEnvPath = path.join(
    process.env.PACKAGE_PATH as string,
    "tests",
    "unit",
    "vcast"
  );
  const tstFilepath = path.join(
    testEnvPath,
    process.env.TST_FILENAME as string
  );
  const uri = URI.file(tstFilepath).toString();
  const tstTextDocument = TextDocument.create(uri, languageId, 1, tstText);

  const diagnostics: Diagnostic[] = validateTextDocument(tstTextDocument);
  const diagnosticMessages = diagnostics.map(
    (diagnostics) => diagnostics.message
  );

  return diagnosticMessages;
}
