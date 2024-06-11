import {
  type TextDocument,
  type Diagnostic,
  type Position,
} from "vscode-languageserver";
import { testCommandList, scriptFeatureList } from "./serverUtilities";

const vscode_languageserver = require("vscode-languageserver");

function diagnostic(
  line: number,
  start: number,
  end: number,
  message: string
): Diagnostic {
  const startPosition: Position = { line, character: start };
  const endPosition: Position = { line, character: end };

  const diagnostic: Diagnostic = {
    severity: vscode_languageserver.DiagnosticSeverity.Warning,
    range: {
      start: startPosition,
      end: endPosition,
    },
    message,
    source: "TST Editor",
  };
  return diagnostic;
}

const specialSubprogramNames = new Set(["<<INIT>>", "<<COMPOUND>>"]);

export function validateTextDocument(textDocument: TextDocument) {
  // This function does the error checking for the test script
  // and generates diagnostics for any issues

  const diagnosticList: Diagnostic[] = [];

  let lineIndex = 0;
  const text = textDocument.getText();
  const lineList = text.split(/\r?\n/g);

  let currentUnit = "";
  let currentFunction = "";
  let withinTest = false;
  let withinNotes = false;
  let withinFlow = false;
  let withinValueUserCode = false;
  let withinExpectedUserCode = false;
  let withinImportFailures = false;

  for (lineIndex = 0; lineIndex < lineList.length; lineIndex++) {
    const thisLine: string = lineList[lineIndex];

    if (thisLine.startsWith("TEST")) {
      const pieces = thisLine.split(/(?<!:)[:.](?!:)/);
      let command = "";
      if (pieces.length > 1) command = pieces[1].trim();

      // Test-level commands
      if (withinTest) {
        if (withinNotes) {
          if (command == "END_NOTES") withinNotes = false;
          else
            diagnosticList.push(
              diagnostic(
                lineIndex,
                0,
                1000,
                'Commands cannot be nested in a "NOTES" block'
              )
            );
        } else if (withinFlow) {
          if (command == "END_FLOW") withinFlow = false;
          else
            diagnosticList.push(
              diagnostic(
                lineIndex,
                0,
                1000,
                'Commands cannot be nested in a "FLOW" block'
              )
            );
        } else if (withinValueUserCode) {
          if (command == "END_VALUE_USER_CODE") withinValueUserCode = false;
          else
            diagnosticList.push(
              diagnostic(
                lineIndex,
                0,
                1000,
                'Commands cannot be nested in a "VALUE_USER_CODE" block'
              )
            );
        } else if (withinExpectedUserCode) {
          if (command == "END_EXPECTED_USER_CODE")
            withinExpectedUserCode = false;
          else
            diagnosticList.push(
              diagnostic(
                lineIndex,
                0,
                1000,
                'Commands cannot be nested in a "EXPECTED_USER_CODE" block'
              )
            );
        } else if (withinImportFailures) {
          if (command == "END_IMPORT_FAILURES") withinImportFailures = false;
          else
            diagnosticList.push(
              diagnostic(
                lineIndex,
                0,
                1000,
                'Commands cannot be nested in a "IMPORT_FAILURES" block'
              )
            );
        } else if (
          command == "VALUE" ||
          command == "EXPECTED" ||
          command == "STUB" ||
          command == "SLOT" ||
          command == "REQUIREMENT_KEY"
        ) {
          // TBD: we should validate in python
        } else if (command == "NAME") {
        } else if (command == "NOTES") {
          withinNotes = true;
        } else if (command == "FLOW") {
          withinFlow = true;
        } else if (command == "VALUE_USER_CODE") {
          withinValueUserCode = true;
        } else if (command == "EXPECTED_USER_CODE") {
          withinExpectedUserCode = true;
        } else if (command == "IMPORT_FAILURES") {
          withinImportFailures = true;
        } else if (command == "END") {
          withinTest = false;
        }
      }
      // File-level commands
      else if (!testCommandList.includes(command)) {
        diagnosticList.push(
          diagnostic(
            lineIndex,
            0,
            1000,
            "Invalid command, type TEST. to see all command values"
          )
        );
      } else if (command == "UNIT") {
        currentUnit = pieces[2];
      } else if (command == "SUBPROGRAM") {
        currentFunction = pieces[2];
        if (currentUnit == "" && !specialSubprogramNames.has(currentFunction))
          diagnosticList.push(
            diagnostic(lineIndex, 0, 1000, "TEST.UNIT is required but missing")
          );
      } else if (command == "NEW" || command == "REPLACE" || command == "ADD") {
        if (currentFunction == "") {
          diagnosticList.push(
            diagnostic(
              lineIndex,
              0,
              1000,
              "TEST.SUBPRORGRAM is required but missing"
            )
          );
        }

        withinTest = true;
      } else if (command == "END") {
        if (!withinTest) {
          diagnosticList.push(
            diagnostic(
              lineIndex,
              0,
              1000,
              "TEST.NEW | REPLACE is required but missing"
            )
          );
        }
      } else if (command == "SCRIPT_FEATURE" && pieces.length > 2) {
        const featureName = pieces[2].trim();
        if (!scriptFeatureList.includes(featureName)) {
          diagnosticList.push(
            diagnostic(
              lineIndex,
              0,
              1000,
              "Invalid feature flag, type TEST.SCRIPT_FEATURE: to see a all flags"
            )
          );
        }
      } else {
        // This is a valid TEST command, but it does not belong in the file scope
        diagnosticList.push(
          diagnostic(
            lineIndex,
            0,
            1000,
            "Command is only valid within a TEST.NEW | REPLACE -> TEST.END block "
          )
        );
      }
    } // End if this is a TEST command
    else if (
      !(
        // Nothing to be done for comments, blanks lines and notes
        (
          withinNotes ||
          withinFlow ||
          withinValueUserCode ||
          withinExpectedUserCode ||
          withinImportFailures ||
          /^\s*\/\/.*$/.test(thisLine) ||
          /^\s*--.*$/.test(thisLine) ||
          thisLine.trim().length === 0
        )
      )
    ) {
      const message = "Illegal line, comments must start with -- or //";
      diagnosticList.push(diagnostic(lineIndex, 0, 1000, message));
    }
  } // End for loop

  return diagnosticList;
}
