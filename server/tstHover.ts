import url = require("url");
import {
  getEnviroNameFromTestScript,
  getLineFragment,
  getLineText,
  getPieceAtColumn,
} from "./serverUtilities";

import { TextDocuments, CompletionParams } from "vscode-languageserver";

import { getChoiceDataFromPython } from "./pythonUtilities";

export function getHoverString(
  documents: TextDocuments,
  completionData: CompletionParams
) {
  const document = documents.get(completionData.textDocument.uri);
  let hoverString = "";

  if (document) {
    const testScriptPath = url.fileURLToPath(completionData.textDocument.uri);
    const enviroPath = getEnviroNameFromTestScript(testScriptPath);

    if (enviroPath) {
      // Sets hover to the field under the cursor
      // const hoverString = getPieceOfLine (completionData);

      const fullLine = getLineText(document, completionData.position.line);

      // generate a list of pieces ...
      // this regex creates a set of delimiters that are either . or : but NOT ::
      const pieces = fullLine.split(/(?<!:)[:\.](?!:)/);

      const upperCaseLine: string = fullLine.toUpperCase();

      // only doing hover for TEST.VALUE and TEST.EXPECTED
      if (
        upperCaseLine.startsWith("TEST.EXPECTED:") ||
        upperCaseLine.startsWith("TEST.VALUE:")
      ) {
        // get the piece we are hovering over and its index
        const fieldObject = getPieceAtColumn(
          pieces,
          completionData.position.character
        );

        // we only care about the stuff at the param level and deeper
        if (fieldObject.index > 3) {
          // array fields may/will look like this: data[23]
          fieldObject.text = fieldObject.text.split("[")[0];
          // get start of line to cursor for the call to python
          const lineSoFar: string = getLineFragment(
            document,
            completionData.position
          );

          // call python to get the list for this field, and then ...
          // match up that piece to find the "extra stuff" to display
          const choiceData = getChoiceDataFromPython(enviroPath, lineSoFar);
          const valueList = choiceData.choiceList;
          for (var index = 0; index < valueList.length; index++) {
            const valuePieces = valueList[index].split("@");
            if (valuePieces[0] == fieldObject.text) {
              hoverString = valuePieces[1];
              break;
            }
          }
        }
      } else if (upperCaseLine.startsWith("TEST.SLOT:"))
        // just to remind users of the format :)
        hoverString =
          "format: slot-number, unit-name, function-name, iteration-count, test-name";
      else {
        // invalid enviroName
        hoverString = "";
      }
    }
  }

  return hoverString;
}
