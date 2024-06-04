import {
  CompletionParams,
  CompletionItem,
  CompletionItemKind,
  TextDocuments,
} from "vscode-languageserver";

import { choiceKindType, getChoiceDataFromPython } from "./pythonUtilities";

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

    // Identify lines of interest, so lines that start with
    //     void vmock
    //     auto vmock_session =
    if (
      lineSoFar.match(/^\s*void\s+vmock/) ||
      lineSoFar.match(/^\s*auto\s+vmock_session\s*=\s*/)
    ) {
      const jsonData = getChoiceDataFromPython(
        choiceKindType.choiceListCT,
        enviroPath,
        lineSoFar
      );
      listToReturn = jsonData.choiceList;
    }
  }
  return completionList(listToReturn, CompletionItemKind.Text);
}
