import {
  CompletionParams,
  CompletionItem,
  CompletionItemKind,
  TextDocuments,
} from "vscode-languageserver";

import { Position, Range, TextEdit } from "vscode-languageserver-types";

import { choiceKindType, getChoiceDataFromPython } from "./pythonUtilities";

import { completionList, getLineFragment } from "./serverUtilities";

export function getCodedTestCompletionData(
  documents: TextDocuments,
  enviroPath: string,
  completionData: CompletionParams
): CompletionItem[] {

  // variables used to construct the completion item list
  let listToReturn: string[] = [];
  const document = documents.get(completionData.textDocument.uri);
  let extraText: string = "";

  if (document) {
    const lineSoFar = getLineFragment(
      document,
      completionData.position
    ).trimEnd();

    // Identify lines of interest, so lines that start with
    //     // vmock
    //     auto vmock_session =
    if (
      lineSoFar.match(/^\s*\/\/\s*vmock\s*/) ||
      lineSoFar.match(/^\s*auto\s+vmock_session\s*=\s*/)
    ) {
      const jsonData = getChoiceDataFromPython(
        choiceKindType.choiceListCT,
        enviroPath,
        lineSoFar
      );
      listToReturn = jsonData.choiceList;
      // not currently used, left in for future usage
      extraText = jsonData.extraText;
    }
  }
  // create a vscode CompletionItem List for the choices

  let completionItemList = completionList(
    listToReturn,
    CompletionItemKind.Text
  );

  if (extraText.length > 0 && completionItemList.length > 0) {
    // extraText could be used to make an edit somewhere else in the file
    const location = completionData.position.line + 1;
    addAdditionalEdits(completionItemList[0], extraText, location);
  }

  return completionItemList;
}

function addAdditionalEdits(
  completionItem: CompletionItem,
  textToInsert: string,
  location: number
) {
  // TBD today - why do we need a range, seems like insert in one place is fine
  const insertPosition: Position = Position.create(location, 0);
  const insertRange: Range = { start: insertPosition, end: insertPosition };
  const edit: TextEdit = { range: insertRange, newText: "// " + textToInsert };

  completionItem.additionalTextEdits = [edit];
}
