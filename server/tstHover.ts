import url = require("url");
import {
  type TextDocuments,
  type CompletionParams,
} from "vscode-languageserver";
import {
  getEnviroNameFromTestScript,
  getLineFragment,
  getLineText,
  getPieceAtColumn,
} from "./serverUtilities";
import {
  getChoiceDataFromPython,
  getHoverStringForRequirement,
} from "./pythonUtilities";

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

      // Generate a list of pieces ...
      // this regex creates a set of delimiters that are either . or : but NOT ::
      const pieces = fullLine.split(/(?<!:)[:.](?!:)/);

      const upperCaseLine: string = fullLine.toUpperCase();

      // Doing hover for TEST.VALUE, TEST.EXPECTED, TEST.REQUIREMENT_KEY

      if (upperCaseLine.startsWith("TEST.REQUIREMENT_KEY:")) {
        // If we have 3 pieces, then we have a requirement key
        // the line should look like TEST.REQUIREMENT_KEY: <key>  or <key> | <title>
        // IF the title is already there we don't need to do the hover-over
        if (pieces.length >= 3) {
          let key = "";
          key = pieces[2].includes("|")
            ? pieces[2].split("|")[0].trim()
            : pieces[2].trim();
          // Now find the title for this key, via a python call
          hoverString = getHoverStringForRequirement(enviroPath, key);
          console.log(hoverString);
        }
      } else if (
        upperCaseLine.startsWith("TEST.EXPECTED:") ||
        upperCaseLine.startsWith("TEST.VALUE:")
      ) {
        // Get the piece we are hovering over and its index
        const fieldObject = getPieceAtColumn(
          pieces,
          completionData.position.character
        );

        // We only care about the stuff at the param level and deeper
        if (fieldObject.index > 3) {
          // Array fields may/will look like this: data[23]
          fieldObject.text = fieldObject.text.split("[")[0];
          // Get start of line to cursor for the call to python
          const lineSoFar: string = getLineFragment(
            document,
            completionData.position
          );

          // Call python to get the list for this field, and then ...
          // match up that piece to find the "extra stuff" to display
          const choiceData = getChoiceDataFromPython(enviroPath, lineSoFar);
          const valueList = choiceData.choiceList;
          for (const element of valueList) {
            const valuePieces = element.split("@");
            if (valuePieces[0] == fieldObject.text) {
              hoverString = valuePieces[1];
              break;
            }
          }
        }
      } else if (upperCaseLine.startsWith("TEST.SLOT:"))
        // Just to remind users of the format :)
        hoverString =
          "format: slot-number, unit-name, function-name, iteration-count, test-name";
      else {
        // Invalid enviroName
        hoverString = "";
      }
    }
  }

  return hoverString;
}
