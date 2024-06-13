import fs = require("fs");
import url = require("url");
import {
  type TextDocuments,
  type CompletionParams,
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
import { getChoiceDataFromPython } from "./pythonUtilities";

export function getTstCompletionData(
  documents: TextDocuments,
  completionData: CompletionParams
) {
  const document = documents.get(completionData.textDocument.uri);
  if (document) {
    const testScriptPath = url.fileURLToPath(completionData.textDocument.uri);
    const enviroPath = getEnviroNameFromTestScript(testScriptPath);
    if (enviroPath && fs.existsSync(enviroPath)) {
      // The work we do is dependent on the trigger
      const context = completionData.context;
      let trigger = getTriggerFromContext(context);
      const lineSoFar = getLineFragment(document, completionData.position);
      const upperCaseLine = lineSoFar.toUpperCase();

      if (trigger == "CR") {
        // start of new line
        const subprogramName = getNearest(
          document,
          "SUBPROGRAM",
          completionData.position.line
        );
        if (subprogramName == "<<COMPOUND>>")
          return completionList(
            ["TEST", "TEST.SLOT", "\n"],
            CompletionItemKind.Keyword
          );
        return completionList(
            ["TEST", "TEST.VALUE", "TEST.EXPECTED", "\n"],
            CompletionItemKind.Keyword
          );
      } if (trigger == "DOT" && upperCaseLine == "TEST.") {
        return completionList(testCommandList, CompletionItemKind.Keyword);
      } if (trigger == "COLON" && upperCaseLine == "TEST.NAME:")
        return completionList(["<test-name>"], CompletionItemKind.Text);
      if (trigger == "COLON" && upperCaseLine == "TEST.UNIT:") {
        const choiceData = getChoiceDataFromPython(enviroPath, lineSoFar);
        return completionList(
          choiceData.choiceList,
          convertKind(choiceData.choiceKind)
        );
      } if (trigger == "COLON" && upperCaseLine == "TEST.SCRIPT_FEATURE:")
        return completionList(scriptFeatureList, CompletionItemKind.Keyword);
      if (trigger == "COLON" && upperCaseLine == "TEST.SUBPROGRAM:") {
        // find closest TEST.UNIT above this line ...
        const unitName = getNearest(
          document,
          "UNIT",
          completionData.position.line
        );
        // we use python to get a list of subprograms by creating a fake VALUE line
        // with the unitName set to what we found
        let choiceArray = ["<<INIT>>", "<<COMPOUND>>"];
        let choiceKind: CompletionItemKind = CompletionItemKind.Keyword;
        if (unitName.length > 0) {
          const choiceData = getChoiceDataFromPython(
            enviroPath,
            "TEST.VALUE:" + unitName + "."
          );
          choiceArray = choiceArray.concat(choiceData.choiceList);
          choiceKind = convertKind(choiceData.choiceKind);
          // <<GLOBAL>> is valid on VALUE lines but not as a function name!
          const index = choiceArray.indexOf("<<GLOBAL>>");
          if (index > -1) {
            choiceArray.splice(index, 1); // 2nd parameter means remove one item only
          }
        }
        return completionList(choiceArray, choiceKind);
      } if (upperCaseLine.startsWith("TEST.SLOT:")) {
        const choiceData = getChoiceDataFromPython(enviroPath, lineSoFar);
        return completionList(
          choiceData.choiceList,
          convertKind(choiceData.choiceKind)
        );
      }

      // this handles the everything else
      if (
        upperCaseLine.startsWith("TEST.EXPECTED:") ||
        upperCaseLine.startsWith("TEST.VALUE:") ||
        upperCaseLine.startsWith("TEST.VALUE_USER_CODE:") ||
        upperCaseLine.startsWith("TEST.EXPECTED_USER_CODE:") ||
        upperCaseLine.startsWith("TEST.STUB:")
      ) {
        // the current level, and returns the appropriate list for the next level.
        const choiceData = getChoiceDataFromPython(enviroPath, lineSoFar);
        return completionList(
          choiceData.choiceList,
          convertKind(choiceData.choiceKind)
        );
      } if (upperCaseLine.startsWith("TEST.REQUIREMENT_KEY:")) {
        // for the requirement keys, the format of the list items is
        const choiceData = getChoiceDataFromPython(enviroPath, lineSoFar);
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
    } 
      // invalid enviroName
      return [];
    
  } else {
    // no document
    return [];
  }
}
