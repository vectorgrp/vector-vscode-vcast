import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import {
  TextDocument,
  TextDocuments,
  type Diagnostic,
} from "vscode-languageserver";
import { CompletionTriggerKind } from "vscode-languageserver-protocol";
import URI from "vscode-uri";
import { vi } from "vitest";
import { getHoverString } from "../../server/tstHover";
import { getTstCompletionData } from "../../server/tstCompletion";
import { validateTextDocument } from "../../server/tstValidation";
import { initializePaths } from "../../server/pythonUtilities";
import { getCodedTestCompletionData } from "../../server/ctCompletions";
import {
  buildCompletionList,
  convertKind,
  getEnviroNameFromTestScript,
} from "../../server/serverUtilities";

export type HoverPosition = {
  line: number;
  character: number;
};

export async function generateHoverData(
  tstText: string,
  position: HoverPosition,
  envName?: string
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
  storeNewDocument(documents, uri, textDocument);

  const completion = asHoverParameters(textDocument, position);

  const extensionRoot: string = process.env.PACKAGE_PATH || "";
  const useServer: boolean = process.env.USE_SERVER !== undefined;
  initializePaths(extensionRoot, "vpython", useServer);

  if (textDocument) {
    console.log(`Input .tst script: \n ${textDocument.getText()} \n`);
  }
  return await getHoverString(documents, completion);
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

export async function generateCompletionData(
  tstText: string,
  position: CompletionPosition,
  triggerCharacter: string | undefined,
  optParameters?: {
    lineSoFar?: string;
    cppTest?: boolean;
    envName?: string;
  }
) {
  // OptParams can be undefined
  const envName = optParameters?.envName ?? "vcast";

  const languageId = optParameters?.cppTest ? "cpp" : "VectorCAST Test Script";

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
  const completion = asCompletionParameters(
    textDocument,
    position,
    triggerCharacter
  );

  const extensionRoot: string = process.env.PACKAGE_PATH || "";
  const useServer: boolean = process.env.USE_SERVER !== undefined;
  initializePaths(extensionRoot, "vpython", useServer);

  // Coded test
  if (optParameters?.cppTest && optParameters?.lineSoFar) {
    console.log(`Input .cpp file: \n ${textDocument.getText()} \n`);
    const enviroPath = getEnviroNameFromTestScript(tstFilepath);
    // TBD TODAY - Should this test create a "connection" object?
    if (enviroPath) {
      return getCodedTestCompletionData(
        undefined,
        optParameters.lineSoFar,
        completion,
        enviroPath
      );
    }

    throw new ReferenceError("enviroPath is undefined.");
  } /* tst */ else {
    console.log(`Input .tst script: \n ${textDocument.getText()} \n`);
    const completionData = await getTstCompletionData(textDocument, completion);
    return buildCompletionList(
      completionData.choiceList,
      convertKind(completionData.choiceKind)
    );
  }
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

export function storeNewDocument(
  documents: TextDocuments,
  uri: string,
  textDocument: TextDocument | undefined
) {
  /* `_documents` is private in `TextDocuments`.
   * We cast to `any` to make the linter happy */

  (documents as any)._documents[uri] = textDocument;
}

/**
 * Executes a given command and logs any errors that occur during execution.
 *
 * @param {string} command - The command to be executed.
 * @returns {Promise<void>} - A promise that resolves when the command has been executed or rejects if an error occurs.
 */
export async function runCommand(command: string): Promise<void> {
  const promisifiedExec = promisify(exec);
  const { stdout, stderr } = await promisifiedExec(command);
  if (stderr) {
    console.log(stderr);
    throw new Error(`Error when running ${command}`);
  }

  console.log(stdout);
}

/**
 * Prepares the necessary parameters for testing coded test completion.
 *
 * @param lineToComplete The line in the test file where completion is triggered.
 * @param unitTst        The unit test code content (can be empty).
 * @param envName        The name of the environment (e.g., "vcast").
 * @param languageId     The language ID of the test file (e.g., "cpp").
 * @return An object containing the completion parameters and environment path.
 */
export async function prepareCodedTestCompletion(
  lineToComplete: string,
  unitTst: string,
  envName: string,
  languageId: string
) {
  const completionPosition = getCompletionPositionForLine(
    lineToComplete,
    unitTst
  );

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

  const triggerCharacter = lineToComplete.at(-1);
  const uri = URI.file(tstFilepath).toString();
  const textDocument = TextDocument.create(uri, languageId, 1, unitTst);

  const completion = asCompletionParameters(
    textDocument,
    completionPosition,
    triggerCharacter
  );

  const enviroPath = getEnviroNameFromTestScript(tstFilepath);

  return { completion, enviroPath, lineToComplete };
}

/**
 * Mocks the diagnostic object and sets up the connection.
 *
 * @param diagnostic Diagnostic object to be mocked.
 * @returns An object containing the mocked connection and sendDiagnostics function.
 */
export const setupDiagnosticTest = (diagnostic: Diagnostic) => {
  vi.mock(".../../server/tstValidation", () => ({
    getDiagnosticObject: vi.fn().mockReturnValue(diagnostic),
  }));

  const mockSendDiagnostics = vi.fn();

  const connection = {
    sendDiagnostics: mockSendDiagnostics,
  };

  return { connection, mockSendDiagnostics };
};
