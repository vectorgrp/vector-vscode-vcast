/* eslint-disable @typescript-eslint/no-var-requires */
import { TextDocument, TextDocuments, Diagnostic } from "vscode-languageserver";
import { getHoverString } from "../../server/tstHover";
import { setPaths } from "../../server/pythonUtilities";
import { getTstCompletionData } from "../../server/tstCompletion";
import { CompletionTriggerKind } from "vscode-languageserver-protocol";
import { validateTextDocument } from "../../server/tstValidation";
import URI from "vscode-uri";
const path = require("path");

export interface HoverPosition {
  line: number;
  character: number;
}

export function generateHoverData(
  tstText: string,
  position: HoverPosition,
  envName?: string,
  emptyDoc?: boolean
) {
  if (!envName) {
    envName = "vcast";
  }
  const languageId = "VectorCAST Test Script";
  const testEnvPath = path.join(
    process.env["PACKAGE_PATH"],
    "tests",
    "unit",
    envName
  );
  const tst_filepath = path.join(testEnvPath, process.env["TST_FILENAME"]);
  const uri = URI.file(tst_filepath).toString();

  const textDoc = TextDocument.create(uri, languageId, 1, tstText);
  const documents = new TextDocuments();

  if (emptyDoc) {
    documents["_documents"][uri] = undefined;
  } else {
    documents["_documents"][uri] = textDoc;
  }

  const completion = asHoverParams(textDoc, position);

  setPaths(
    path.join(process.env["PACKAGE_PATH"], "python", "testEditorInterface.py"),
    "vpython"
  );

  if (documents.all() && documents.all()[0]) {
    console.log(`Input .tst script: \n ${documents.all()[0].getText()} \n`);
  }
  return getHoverString(documents, completion);
}

export function asHoverParams(
  textDocument: TextDocument,
  position: HoverPosition
) {
  return {
    textDocument: textDocument,
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

export interface CompletionPosition {
  line: number;
  character: number;
}

export function generateCompletionData(
  tstText: string,
  position: CompletionPosition,
  triggerCharacter: string | undefined,
  envName?: string,
  emptyDoc?: boolean
) {
  if (!envName) {
    envName = "vcast";
  }
  const languageId = "VectorCAST Test Script";
  const testEnvPath = path.join(
    process.env["PACKAGE_PATH"],
    "tests",
    "unit",
    envName
  );
  const tst_filepath = path.join(testEnvPath, process.env["TST_FILENAME"]);
  const uri = URI.file(tst_filepath).toString();

  const textDoc = TextDocument.create(uri, languageId, 1, tstText);
  const documents = new TextDocuments();

  if (emptyDoc) {
    documents["_documents"][uri] = undefined;
  } else {
    documents["_documents"][uri] = textDoc;
  }

  const completion = asCompletionParams(textDoc, position, triggerCharacter);
  setPaths(
    path.join(process.env["PACKAGE_PATH"], "python", "testEditorInterface.py"),
    "vpython"
  );

  if (documents.all() && documents.all()[0]) {
    console.log(`Input .tst script: \n ${documents.all()[0].getText()} \n`);
  }
  return getTstCompletionData(documents, completion);
}

export function asCompletionParams(
  textDocument: TextDocument,
  position: CompletionPosition,
  triggerCharacter: string | undefined
) {
  return {
    textDocument: textDocument,
    position: { line: position.line, character: position.character },
    context: {
      triggerKind: CompletionTriggerKind.TriggerCharacter,
      triggerCharacter: triggerCharacter,
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
    process.env["PACKAGE_PATH"],
    "tests",
    "unit",
    "vcast"
  );
  const tst_filepath = path.join(testEnvPath, process.env["TST_FILENAME"]);
  const uri = URI.file(tst_filepath).toString();
  const tstTextDoc = TextDocument.create(uri, languageId, 1, tstText);

  const diagnostics: Diagnostic[] = validateTextDocument(tstTextDoc);
  const diagnosticMessages = diagnostics.map(
    (diagnostics) => diagnostics.message
  );

  return diagnosticMessages;
}
