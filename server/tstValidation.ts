import { TextDocument, Diagnostic, Position } from "vscode-languageserver";

import { testCommandList, scriptFeatureList } from "./serverUtilities";

const vscode_languageserver = require("vscode-languageserver");

function diagnostic(
  line: number,
  start: number,
  end: number,
  message: string
): Diagnostic {
  let startPosition: Position = { line: line, character: start };
  let endPosition: Position = { line: line, character: end };

  let diagnostic: Diagnostic = {
    severity: vscode_languageserver.DiagnosticSeverity.Warning,
    range: {
      start: startPosition,
      end: endPosition,
    },
    message: message,
    source: "TST Editor",
  };
  return diagnostic;
}

const specialSubprogramNames = ["<<INIT>>", "<<COMPOUND>>"];

export function validateTextDocument(textDocument: TextDocument) {
  // this function does the error checking for the test script
  // and generates diagostics for any issues

  let diagnosticList: Diagnostic[] = [];

  let lineIndex = 0;
  let text = textDocument.getText();
  let lineList = text.split(/\r?\n/g);

  let currentUnit = "";
  let currentFunction = "";
  let withinTest: boolean = false;
  let withinNotes: boolean = false;
  let withinFlow: boolean = false;
  let withinValueUserCode: boolean = false;
  let withinExpectedUserCode: boolean = false;
  let withinImportFailures = false;

  for (lineIndex = 0; lineIndex < lineList.length; lineIndex++) {
    let thisLine: string = lineList[lineIndex];

    if (thisLine.startsWith("TEST")) {
      const pieces = thisLine.split(/(?<!:)[:\.](?!:)/);
      let command = "";
      if (pieces.length > 1) command = pieces[1].trim();

      // test-level commands
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
          command == "SLOT"
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
      //file-level commands
      else {
        if (testCommandList.indexOf(command) < 0) {
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
          if (
            currentUnit == "" &&
            !specialSubprogramNames.includes(currentFunction)
          )
            diagnosticList.push(
              diagnostic(
                lineIndex,
                0,
                1000,
                "TEST.UNIT is required but missing"
              )
            );
        } else if (
          command == "NEW" ||
          command == "REPLACE" ||
          command == "ADD"
        ) {
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
        } else if (command == "SCRIPT_FEATURE") {
          const featureName = pieces[2].trim();
          if (scriptFeatureList.indexOf(featureName) < 0) {
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
          // this is a valid TEST command, but it does not belong in the file scope
          diagnosticList.push(
            diagnostic(
              lineIndex,
              0,
              1000,
              "Command is only valid within a TEST.NEW | REPLACE -> TEST.END block "
            )
          );
        }
      }
    } // end if this is a TEST command
    else if (
      !(
        // nothing to be done for comments, blanks lines and notes
        (
          withinNotes ||
          withinFlow ||
          withinValueUserCode ||
          withinExpectedUserCode ||
          withinImportFailures ||
          thisLine.match(/^\s*\/\/.*$/) ||
          thisLine.match(/^\s*--.*$/) ||
          thisLine.trim().length == 0
        )
      )
    ) {
      let message = "Illegal line, comments must start with -- or //";
      diagnosticList.push(diagnostic(lineIndex, 0, 1000, message));
    }

    // TBD The lsp example implemented some .relatedInfomration
    // for the diagnostic object here ???
  } // end for loop

  return diagnosticList;
}
