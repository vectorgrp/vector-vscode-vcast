import {
  CompletionParams,
  CompletionItem,
  CompletionItemKind,
  TextDocuments,
} from "vscode-languageserver";

import { getChoiceDataFromPython } from "./pythonUtilities";

import { completionList, getLineFragment } from "./serverUtilities";

export function getCodedTestCompletionData(
  documents: TextDocuments,
  enviroPath: string,
  completionData: CompletionParams
): CompletionItem[] {
  let listToReturn: string[] = [];
  const document = documents.get(completionData.textDocument.uri);
  if (document) {
    const lineSoFar = getLineFragment(
      document,
      completionData.position
    ).trimEnd();

    // Identify lines of interest
    // so lines that start with void vmock
    if (lineSoFar.match (/^\s*void\s+vmock/)) {
      const jsonData = getChoiceDataFromPython(enviroPath, lineSoFar);
      listToReturn = jsonData.choiceList;
    }
  }
  return completionList(listToReturn, CompletionItemKind.Text);
}
