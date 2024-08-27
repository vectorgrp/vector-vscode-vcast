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

function filterArray(currentArray: string[], whatToRemove: string) {
  return currentArray.filter((element) => element !== whatToRemove);
}

export async function getTstCompletionData(
  currentDocument: TextDocument,
  completionData: CompletionParams
): Promise<choiceDataType> {
  let returnData: choiceDataType = emptyChoiceData;
  const testScriptPath = url.fileURLToPath(completionData.textDocument.uri);
  const enviroPath = getEnviroNameFromTestScript(testScriptPath);

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
      const unitName = getNearest(
        currentDocument,
        "UNIT",
        completionData.position.line
      );
      // TBD will need to change how this is done during the fix for issue #170
      // we use python to get a list of subprograms by creating a fake VALUE line
      // with the unitName set to what we found
      let choiceArray = ["<<INIT>>", "<<COMPOUND>>"];
      let choiceKind = "Keyword";
      if (unitName.length > 0) {
        const choiceData = await getChoiceData(
          choiceKindType.choiceListTST,
          enviroPath,
          "TEST.VALUE:" + unitName + "."
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
    } else if (upperCaseLine.startsWith("TEST.SLOT:")) {
      returnData = await getChoiceData(
        choiceKindType.choiceListTST,
        enviroPath,
        lineSoFar
      );
    } else if (
      // this handles the everything else
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
    }
  } // enviroPath is valid

  return returnData;
}
