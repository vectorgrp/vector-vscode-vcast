import {
  TextDocument,
  Diagnostic,
  DiagnosticSeverity,
  Position,
} from "vscode-languageserver";

import {
  testCommandList,
  scriptFeatureList,
  getEnviroNameFromTestScript,
} from "./serverUtilities";
import { checkForKeywordInLine } from "./tstCompletion";
import url = require("url");
import fs = require("fs");
import path from "path";

export function getDiagnosticObject(
  line: number,
  start: number,
  end: number,
  message: string,
  severity: DiagnosticSeverity = DiagnosticSeverity.Warning
): Diagnostic {
  let startPosition: Position = { line: line, character: start };
  let endPosition: Position = { line: line, character: end };

  let diagnostic: Diagnostic = {
    severity: severity,
    range: {
      start: startPosition,
      end: endPosition,
    },
    message: message,
    source: "VectorCAST Test Explorer",
  };
  return diagnostic;
}

/**
 * Validates whether the given enviroPath meets the following criteria:
 * 1) Its parent directory contains a file named CCAST_.CFG
 * 2) That file contains a line starting with "VCAST_REPOSITORY: " followed by a path
 * 3) That path contains a file at requirements_gateway/requirements.json
 *
 * @param enviroPath - Path to the environment directory (test script parent)
 * @returns true if all checks pass, false otherwise
 */
export function requirementsGatewayIsExistent(enviroPath: string): boolean {
  try {
    // Find CCAST_.CFG one level up
    const parentDir = path.resolve(enviroPath, "..");
    const cfgPath = path.join(parentDir, "CCAST_.CFG");
    if (!fs.existsSync(cfgPath)) {
      console.log(`Configuration file not found: ${cfgPath}`);
      return false;
    }

    // Read the CFG file and look for VCAST_REPOSITORY
    const contents = fs.readFileSync(cfgPath, "utf8");
    const lines = contents.split(/\r?\n/);
    const repoLine = lines.find((line) => line.startsWith("VCAST_REPOSITORY:"));
    if (!repoLine) {
      console.log(`VCAST_REPOSITORY option not found in ${cfgPath}`);
      return false;
    }

    // Extract repository path
    const parts = repoLine.split(":");
    if (parts.length < 2) {
      console.log("Malformed VCAST_REPOSITORY line in CCAST_.CFG");
      return false;
    }
    const repoPath = parts.slice(1).join(":").trim();
    if (!repoPath) {
      console.log("VCAST_REPOSITORY path is empty");
      return false;
    }

    // Check for requirements.json under requirements_gateway
    const reqJsonPath = path.join(
      repoPath,
      "requirements_gateway",
      "requirements.json"
    );
    if (!fs.existsSync(reqJsonPath)) {
      console.log(`requirements.json not found in: ${reqJsonPath}`);
      return false;
    }

    // All checks passed
    return true;
  } catch (error) {
    // In case of unexpected errors, show message and treat as failure
    console.log(
      `Error validating requirements gateway: ${error instanceof Error ? error.message : error}`
    );
    return false;
  }
}

const specialSubprogramNames = ["<<INIT>>", "<<COMPOUND>>"];

export function validateTextDocument(textDocument: TextDocument) {
  // this function does the error checking for the test script
  // and generates diagnostics for any issues

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
  const codedTestsDriverInSubprogram = checkForKeywordInLine(
    text,
    "TEST.SUBPROGRAM",
    "coded_tests_driver"
  );

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
              getDiagnosticObject(
                lineIndex,
                0,
                1000,
                'Commands cannot be nested in a "NOTES" block',
                DiagnosticSeverity.Warning
              )
            );
        } else if (withinFlow) {
          if (command == "END_FLOW") withinFlow = false;
          else
            diagnosticList.push(
              getDiagnosticObject(
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
              getDiagnosticObject(
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
              getDiagnosticObject(
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
              getDiagnosticObject(
                lineIndex,
                0,
                1000,
                'Commands cannot be nested in a "IMPORT_FAILURES" block'
              )
            );
          // If TEST.SUBPROGRAM is coded_tests_driver, check for disallowed TEST.VALUE and TEST.EXPECTED
        } else if (command == "VALUE" || command == "EXPECTED") {
          if (codedTestsDriverInSubprogram) {
            diagnosticList.push(
              getDiagnosticObject(
                lineIndex,
                0,
                1000,
                "TEST.VALUE and TEST.EXPECTED are not valid when TEST.SUBPROGRAM is set to coded_tests_driver"
              )
            );
          } else {
            // Handle general VALUE or EXPECTED validation
          }
        } else if (command == "REQUIREMENT_KEY") {
          const testScriptPath = url.fileURLToPath(textDocument.uri);
          const enviroPath = getEnviroNameFromTestScript(testScriptPath);
          let reqGatewayExistent = false;
          if (enviroPath) {
            reqGatewayExistent = requirementsGatewayIsExistent(enviroPath);
          }
          if (!reqGatewayExistent) {
            diagnosticList.push(
              getDiagnosticObject(
                lineIndex,
                0,
                1000,
                "TEST.REQUIREMENT_KEY is not valid when the requirements gateway is not present in the environment"
              )
            );
          }
        }
        // Other commands (TBD: validate in Python)
        else if (command == "STUB" || command == "SLOT") {
          // When TEST.SUBPROGRAM is set to coded_tests_driver, TEST.CODED_TEST_FILE should throw an error
        } else if (command == "CODED_TEST_FILE") {
          if (!codedTestsDriverInSubprogram) {
            diagnosticList.push(
              getDiagnosticObject(
                lineIndex,
                0,
                1000,
                "TEST.CODED_TEST_FILE is not valid when TEST.SUBPROGRAM is not set to coded_tests_driver"
              )
            );
          }
          // For all unknown commands within the Test block
        } else if (testCommandList.indexOf(command) < 0) {
          diagnosticList.push(
            getDiagnosticObject(
              lineIndex,
              0,
              1000,
              `Invalid command "${command}", type TEST. to see all command values`
            )
          );
        }
        // TBD: we should validate in python
        else if (command == "NAME") {
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
            getDiagnosticObject(
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
              getDiagnosticObject(
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
              getDiagnosticObject(
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
              getDiagnosticObject(
                lineIndex,
                0,
                1000,
                "TEST.NEW | TEST.REPLACE | TEST.ADD is required but missing"
              )
            );
          }
        } else if (command == "SCRIPT_FEATURE" && pieces.length > 2) {
          const featureName = pieces[2].trim();
          if (scriptFeatureList.indexOf(featureName) < 0) {
            diagnosticList.push(
              getDiagnosticObject(
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
            getDiagnosticObject(
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
      diagnosticList.push(getDiagnosticObject(lineIndex, 0, 1000, message));
    }
  } // end for loop

  return diagnosticList;
}
