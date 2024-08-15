import fs = require("fs");
import url = require("url");
import {
  TextDocument,
  CompletionParams,
  CompletionItemKind,
} from "vscode-languageserver";

import {
  completionList,
  getEnviroNameFromTestScript,
  getLineFragment,
  getNearest,
  getTriggerFromContext,
  testCommandList,
  scriptFeatureList,
  convertKind,
} from "./serverUtilities";

import { choiceKindType, getChoiceData } from "./pythonUtilities";

function filterArray(currentArray: string[], whatToRemove: string) {
  return currentArray.filter((element) => element !== whatToRemove);
}

export async function getTstCompletionData(
  currentDocument: TextDocument,
  completionData: CompletionParams
) {
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
      if (subprogramName == "<<COMPOUND>>")
        return completionList(
          ["TEST", "TEST.SLOT", "\n"],
          CompletionItemKind.Keyword
        );
      else
        return completionList(
          ["TEST", "TEST.VALUE", "TEST.EXPECTED", "\n"],
          CompletionItemKind.Keyword
        );
    } else if (trigger == "DOT" && upperCaseLine == "TEST.") {
      return completionList(testCommandList, CompletionItemKind.Keyword);
    } else if (trigger == "COLON" && upperCaseLine == "TEST.NAME:") {
      return completionList(["<test-name>"], CompletionItemKind.Text);
    } else if (trigger == "COLON" && upperCaseLine == "TEST.UNIT:") {
      const choiceData = await getChoiceData(
        choiceKindType.choiceListTST,
        enviroPath,
        lineSoFar
      );
      return completionList(
        choiceData.choiceList,
        convertKind(choiceData.choiceKind)
      );
    } else if (trigger == "COLON" && upperCaseLine == "TEST.SCRIPT_FEATURE:") {
      return completionList(scriptFeatureList, CompletionItemKind.Keyword);
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
      let choiceKind: CompletionItemKind = CompletionItemKind.Keyword;
      if (unitName.length > 0) {
        const choiceData = await getChoiceData(
          choiceKindType.choiceListTST,
          enviroPath,
          "TEST.VALUE:" + unitName + "."
        );
        choiceArray = choiceArray.concat(choiceData.choiceList);
        choiceKind = convertKind(choiceData.choiceKind);
        // <<GLOBAL>> is valid on VALUE lines but not as a function name!
        choiceArray = filterArray(choiceArray, "<<GLOBAL>>");
      }
      return completionList(choiceArray, choiceKind);
    } else if (upperCaseLine.startsWith("TEST.SLOT:")) {
      const choiceData = await getChoiceData(
        choiceKindType.choiceListTST,
        enviroPath,
        lineSoFar
      );
      return completionList(
        choiceData.choiceList,
        convertKind(choiceData.choiceKind)
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
      const choiceData = await getChoiceData(
        choiceKindType.choiceListTST,
        enviroPath,
        lineSoFar
      );
      return completionList(
        choiceData.choiceList,
        convertKind(choiceData.choiceKind)
      );
    } else if (upperCaseLine.startsWith("TEST.REQUIREMENT_KEY:")) {
      // for the requirement keys, the format of the list items is
      const choiceData = await getChoiceData(
        choiceKindType.choiceListTST,
        enviroPath,
        lineSoFar
      );
      for (let i = 0; i < choiceData.choiceList.length; i++) {
        let line = choiceData.choiceList[i];
        // raw data looks like:  <key> ||| <title> ||| <description>
        const pieces = line.split("|||");
        // remove whitespace and any enclosing quotes ... the vcast RGW example has quotes ...
        const key = pieces[0].trim();
        const title = pieces[1].trim().replace(/['"]+/g, "");
        choiceData.choiceList[i] = `${key} | ${title}`;
      }

      return completionList(
        choiceData.choiceList,
        convertKind(choiceData.choiceKind)
      );
    }
    return [];
  } else {
    // invalid enviroName
    return [];
  }
}
