import fs = require("fs");
import url = require("url");
import { TextDocument, CompletionParams } from "vscode-languageserver";

import {
  getEnviroNameFromTestScript,
  getLineFragment,
  getNearest,
  getTriggerFromContext,
  testCommandList,
  scriptFeatureList,
} from "./serverUtilities";

import {
  choiceDataType,
  choiceKindType,
  emptyChoiceData,
  getChoiceData,
} from "./pythonUtilities";
import { promisify } from "util";
import { exec } from "child_process";

function filterArray(currentArray: string[], whatToRemove: string) {
  return currentArray.filter((element) => element !== whatToRemove);
}

// This is a cache map for the clicast option so that we don't have to check it every time
// Otherwise we would run <clicast get_option> everytime we want autocompletion
const clicastOptionCache = new Map<string, boolean>();

/**
 * Checks if a specific VectorCAST option is set to a given value in the specified environment.
 *
 * @param {string} enviroPath - The file path to the environment where the command should be executed.
 * @param {string} option - The VectorCAST option to check (e.g., 'VCAST_CODED_TESTS_SUPPORT').
 * @param {string} optionValue - The expected value of the option (e.g., 'True', ...).
 * @returns {Promise<boolean>} - Resolves to `true` if the option value matches, otherwise `false`.
 */
export async function checkClicastOption(
  enviroPath: string,
  option: string,
  optionValue: string
): Promise<boolean> {
  const execAsync = promisify(exec);

  // Create a unique cache key using the parameters
  const cacheKey = `${enviroPath}:${option}:${optionValue}`;

  // Check if the result is already cached
  if (clicastOptionCache.has(cacheKey)) {
    return clicastOptionCache.get(cacheKey)!;
  }

  const getCodedTestsSupportCommand = `${process.env.VECTORCAST_DIR}/clicast get_option ${option}`;

  try {
    const { stdout } = await execAsync(getCodedTestsSupportCommand, {
      cwd: enviroPath,
    });
    const result = stdout.includes(`${optionValue}`);
    // Store the result in the cache
    clicastOptionCache.set(cacheKey, result);
    return result;
  } catch (error: any) {
    console.error(`Error executing command: ${error.message}`);
    return false;
  }
}
/**
 * Checks if a specific keyword followed by a colon and a given value exists in the extracted text.
 *
 * @param {string} extractedText - The text to search within.
 * @param {string} keyword - The keyword to search for.
 * @param {string} value - The value that should follow the colon after the keyword.
 * @returns {Promise<boolean>} - Resolves to `true` if the keyword and value are found in the text, otherwise `false`.
 */
export function checkForKeywordInLine(
  extractedText: string,
  keyword: string,
  value: string
): boolean {
  const regex = new RegExp(`^${keyword}:${value}$`);
  const lines = extractedText.split(/\r?\n/);

  for (const line of lines) {
    if (regex.test(line.trim())) {
      return true;
    }
  }

  return false;
}

export async function getTstCompletionData(
  currentDocument: TextDocument,
  completionData: CompletionParams
): Promise<choiceDataType> {
  let returnData: choiceDataType = emptyChoiceData;
  const testScriptPath = url.fileURLToPath(completionData.textDocument.uri);
  const enviroPath = getEnviroNameFromTestScript(testScriptPath);
  const extractedText = currentDocument.getText();

  if (enviroPath && fs.existsSync(enviroPath)) {
    // The work we do is dependent on the trigger
    const context = completionData.context;
    let trigger = getTriggerFromContext(context);
    const lineSoFar = getLineFragment(currentDocument, completionData.position);
    const upperCaseLine = lineSoFar.toUpperCase();

    if (trigger == "CR") {
      // start of new line
      const subprogramName = getNearest(
        currentDocument,
        "SUBPROGRAM",
        completionData.position.line
      );
      if (subprogramName == "<<COMPOUND>>") {
        returnData.choiceKind = "Keyword";
        returnData.choiceList = ["TEST", "TEST.SLOT", "\n"];
      } else {
        returnData.choiceKind = "Keyword";
        returnData.choiceList = ["TEST", "TEST.VALUE", "TEST.EXPECTED", "\n"];
      }
    } else if (trigger == "DOT" && upperCaseLine == "TEST.") {
      returnData.choiceKind = "Keyword";
      returnData.choiceList = testCommandList;

      const codedTestsDriverInSubprogram = checkForKeywordInLine(
        extractedText,
        "TEST.SUBPROGRAM",
        "coded_tests_driver"
      );

      let codedTestsEnabled;

      if (enviroPath) {
        codedTestsEnabled = await checkClicastOption(
          enviroPath,
          "VCAST_CODED_TESTS_SUPPORT",
          "TRUE"
        );
      }
      if (codedTestsEnabled && codedTestsDriverInSubprogram) {
        // Remove "VALUE" and "EXPECTED" as it is not allowed with coded_tests_driver
        returnData.choiceList = returnData.choiceList.filter(
          (item) => item !== "VALUE" && item !== "EXPECTED"
        );
      } else {
        // If coded tests are not enabled, remove "CODED_TEST_FILE"
        returnData.choiceList = returnData.choiceList.filter(
          (item) => item !== "CODED_TEST_FILE"
        );
      }
    } else if (trigger == "COLON" && upperCaseLine == "TEST.NAME:") {
      returnData.choiceKind = "Text";
      returnData.choiceList = ["<test-name>"];
    } else if (trigger == "COLON" && upperCaseLine == "TEST.UNIT:") {
      const choiceData = await getChoiceData(
        choiceKindType.choiceListTST,
        enviroPath,
        lineSoFar
      );
      returnData.choiceKind = choiceData.choiceKind;
      returnData.choiceList = choiceData.choiceList;
    } else if (trigger == "COLON" && upperCaseLine == "TEST.SCRIPT_FEATURE:") {
      returnData.choiceKind = "Keyword";
      returnData.choiceList = scriptFeatureList;
    } else if (trigger == "COLON" && upperCaseLine == "TEST.SUBPROGRAM:") {
      // find closest TEST.UNIT above this line ...
      const unit = getNearest(
        currentDocument,
        "UNIT",
        completionData.position.line
      );

      let choiceKind = "";
      let choiceArray: string[] = [];
      if (unit.length > 0) {
        const choiceData = await getChoiceData(
          choiceKindType.choiceListTST,
          enviroPath,
          upperCaseLine,
          unit
        );
        returnData.extraText = choiceData.extraText;
        returnData.messages = choiceData.messages;
        choiceKind = choiceData.choiceKind;
        // append actual choices to the default INIT and COMPOUND
        choiceArray = choiceArray.concat(choiceData.choiceList);
        // <<GLOBAL>> is valid on VALUE lines but not as a function name!
        choiceArray = filterArray(choiceArray, "<<GLOBAL>>");
      }
      returnData.choiceKind = choiceKind;
      returnData.choiceList = choiceArray;
    } else if (trigger === "COLON" && upperCaseLine.startsWith("TEST.VALUE:")) {
      // Break the line into pieces around single colons
      const parts = lineSoFar.split(/:/);

      // If we've already got +5 colons, stop offering value completions
      if (parts.length - 1 >= 5) {
        return returnData;
      }

      // Look at the parameter name (the part after TEST.VALUE:)
      const paramName = parts[1] || "";

      // If that string contains a ".", we know we’re still on a struct, so we don’t want to complete on :
      if (paramName.includes(".")) {
        return returnData;
      }

      // Otherwise it's scalar, offer normal getChoiceData list
      returnData = await getChoiceData(
        choiceKindType.choiceListTST,
        enviroPath,
        lineSoFar
      );
    } else if (
      upperCaseLine.startsWith("TEST.SLOT:") ||
      upperCaseLine.startsWith("TEST.EXPECTED:") ||
      upperCaseLine.startsWith("TEST.VALUE_USER_CODE:") ||
      upperCaseLine.startsWith("TEST.EXPECTED_USER_CODE:") ||
      // upperCaseLine.startsWith("TEST.VALUE:") ||
      upperCaseLine.startsWith("TEST.STUB:")
    ) {
      // everything else behaves as before
      returnData = await getChoiceData(
        choiceKindType.choiceListTST,
        enviroPath,
        lineSoFar
      );
    }

    // // Handle TEST.VALUE separately so we can suppress extra colons after two
    else if (upperCaseLine.startsWith("TEST.VALUE:")) {
      // count how many ":" are already in the line
      let checkingCount = 5;
      const lineContainsGlobalsOrStubs =
        lineSoFar.includes("USER_GLOBALS_VCAST") ||
        lineSoFar.includes("uut_prototype_stubs");
      // If that is the case, we have 2 colons less (e.g. no Manager::PlaceOrder)
      if (lineContainsGlobalsOrStubs) {
        checkingCount = 3;
      }
      const colonCount = (lineSoFar.match(/:/g) || []).length;
      // 5 for:
      // 1st is after TEST.VALUE":"
      // 2nd & 3rd is TEST.VALUE:Manager"::"PlaceOrder
      // 4th is TEST.VALUE:Manager::PlaceOrder...Entree":"Chicken
      // After the 5th colon, we don't want to offer any more completions
      if (colonCount >= checkingCount) {
        // Already have TEST.VALUE:<u.s.p>:<value>,
        // so do NOT offer any more colon/value completions
        return returnData;
      }
      // Otherwise, offer the normal completions for TEST.VALUE
      returnData = await getChoiceData(
        choiceKindType.choiceListTST,
        enviroPath,
        lineSoFar
      );
    } else if (upperCaseLine.startsWith("TEST.REQUIREMENT_KEY:")) {
      // for the requirement keys, the format of the list items is
      returnData = await getChoiceData(
        choiceKindType.choiceListTST,
        enviroPath,
        lineSoFar
      );
      for (let i = 0; i < returnData.choiceList.length; i++) {
        let line = returnData.choiceList[i];
        // raw data looks like:  <key> ||| <title> ||| <description>
        const pieces = line.split("|||");
        // remove whitespace and any enclosing quotes ...
        // the vcast RGW example has quotes ...
        const key = pieces[0].trim();
        const title = pieces[1].trim().replace(/['"]+/g, "");
        returnData.choiceList[i] = `${key} | ${title}`;
      }
      // No autocompletion yet for TEST.CODED_TEST_FILE:
    } else if (upperCaseLine.startsWith("TEST.CODED_TEST_FILE:")) {
      returnData.choiceKind = "Keyword";
      returnData.choiceList = [];
    }
  } // enviroPath is valid

  // FILTER OUT C_###_###-style global instances (for C++ <<GLOBAL>> cases)
  if (Array.isArray(returnData.choiceList)) {
    returnData.choiceList = returnData.choiceList.filter(
      (item) => !/C_\d+_\d+/.test(item)
    );
  }

  return returnData;
}
