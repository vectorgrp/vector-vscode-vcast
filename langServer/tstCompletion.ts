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
    const { stdout, stderr } = await execAsync(getCodedTestsSupportCommand, {
      cwd: enviroPath,
    });

    if (stderr) {
      console.error(`Error executing command: ${stderr}`);
      return false;
    }

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

  let codedTestsEnabled;

  if (enviroPath) {
    codedTestsEnabled = await checkClicastOption(
      enviroPath,
      "VCAST_CODED_TESTS_SUPPORT",
      "True"
    );
  }

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
      if (codedTestsEnabled && codedTestsDriverInSubprogram) {
        // Check if its already there, otherwise it will be pushed multiple times
        if (!returnData.choiceList.includes("CODED_TEST_FILE")) {
          returnData.choiceList.push("CODED_TEST_FILE");
        }

        // Remove "VALUE" and "EXPECTED" as it is not allowed with coded_tests_driver
        returnData.choiceList = returnData.choiceList.filter(
          (item) => item !== "VALUE" && item !== "EXPECTED"
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

      // TBD will need to change how this is done during the fix for issue #170
      // we use python to get a list of subprograms by creating a fake VALUE line
      // with the unitName set to what we found
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
    } else if (
      // this handles the everything else
      upperCaseLine.startsWith("TEST.SLOT:") ||
      upperCaseLine.startsWith("TEST.EXPECTED:") ||
      upperCaseLine.startsWith("TEST.VALUE:") ||
      upperCaseLine.startsWith("TEST.VALUE_USER_CODE:") ||
      upperCaseLine.startsWith("TEST.EXPECTED_USER_CODE:") ||
      upperCaseLine.startsWith("TEST.STUB:")
    ) {
      // the current level, and returns the appropriate list for the next level.
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

  return returnData;
}
