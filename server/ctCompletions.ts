import {
  CompletionParams,
  CompletionItem,
  CompletionItemKind,
} from "vscode-languageserver";

import { Position, Range, TextEdit } from "vscode-languageserver-types";

import { choiceKindType, getChoiceData } from "./pythonUtilities";

import { completionList } from "./serverUtilities";

// Lines starting with:  // vmock
export const vmockStubRegex = /^\s*\/\/\s*vmock\s*/;

export async function getCodedTestCompletionData(
  connection: any,
  lineSoFar: string,
  completionData: CompletionParams,
  enviroPath: string
): Promise<CompletionItem[]> {
  // variables used to construct the completion item list
  let listToReturn: string[] = [];
  let extraText: string = "";

  // If this is a line of interest, get the choice list from Python
  if (lineSoFar.match(vmockStubRegex)) {
    if (connection) {
      connection.console.log(`Processing: ${lineSoFar}`);
    }
    const jsonData = await getChoiceData(
      choiceKindType.choiceListCT,
      enviroPath,
      lineSoFar
    );
    listToReturn = jsonData.choiceList;
    // not currently used, left in for future usage
    extraText = jsonData.extraText;
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
  // Not sure why we need a range, seems like insert in one place is fine
  const insertPosition: Position = Position.create(location, 0);
  const insertRange: Range = { start: insertPosition, end: insertPosition };
  const edit: TextEdit = { range: insertRange, newText: "// " + textToInsert };

  completionItem.additionalTextEdits = [edit];
}
