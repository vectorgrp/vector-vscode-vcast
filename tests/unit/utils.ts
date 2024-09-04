import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
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
import { getCodedTestCompletionData } from "../../server/ctCompletions";
import { getEnviroNameFromTestScript } from "../../server/serverUtilities";

export type HoverPosition = {
  line: number;
  character: number;
};

export function generateHoverData(
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

  setPaths(
    path.join(
      process.env.PACKAGE_PATH as string,
      "python",
      "testEditorInterface.py"
    ),
    "vpython"
  );

  if (textDocument) {
    console.log(`Input .tst script: \n ${textDocument.getText()} \n`);
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

export function generateCompletionData(
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
  setPaths(
    path.join(
      process.env.PACKAGE_PATH as string,
      "python",
      "testEditorInterface.py"
    ),
    "vpython"
  );

  // Coded test
  if (optParameters?.cppTest && optParameters?.lineSoFar) {
    console.log(`Input .cpp file: \n ${textDocument.getText()} \n`);
    const enviroPath = getEnviroNameFromTestScript(tstFilepath);
    if (enviroPath) {
      return getCodedTestCompletionData(
        optParameters.lineSoFar,
        completion,
        enviroPath
      );
    }

    throw new ReferenceError("enviroPath is undefined.");
  } /* tst */ else {
    console.log(`Input .tst script: \n ${textDocument.getText()} \n`);
    return getTstCompletionData(textDocument, completion);
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

const promisifiedExec = promisify(exec);

/**
 * Function to get the clicast executable path and check the tool version
 */
export async function getToolVersion() {
  // Determine the command to locate clicast
  const checkClicast =
    process.platform === "win32" ? "where clicast" : "which clicast";

  let clicastExecutablePath = "";

  try {
    // Execute the command to find clicast
    const { stdout, stderr } = await promisifiedExec(checkClicast);
    if (stderr) {
      throw new Error(
        `Error when running ${checkClicast}, make sure clicast is on PATH`
      );
    } else {
      clicastExecutablePath = stdout.trim();
      console.log(`clicast found in ${clicastExecutablePath}`);
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(`Unexpected error: ${String(error)}`);
    }

    throw new Error(
      `Error when running "${checkClicast}", make sure clicast is on PATH`
    );
  }

  // Read the tool version from the appropriate path
  const toolVersionPath = path.join(
    clicastExecutablePath,
    "..",
    "DATA",
    "tool_version.txt"
  );

  try {
    const toolVersion: string = fs
      .readFileSync(toolVersionPath)
      .toString()
      .trim();

    // Extract the first two characters
    const firstTwoChars = toolVersion.slice(0, 2);

    // Try to cast the first two characters to a number
    const versionNumber = Number(firstTwoChars);

    // Check if the conversion was successful (not NaN)
    if (!isNaN(versionNumber)) {
      return versionNumber;
    } else {
      console.error(`Error: Could not cast "${firstTwoChars}" to a number`);
      return NaN; // or return an appropriate default
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`Error reading tool version: ${error.message}`);
    } else {
      console.error(`Unexpected error: ${String(error)}`);
    }

    return NaN; // or return an appropriate default
  }
}
