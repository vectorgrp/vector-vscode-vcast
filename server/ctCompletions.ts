
import {
  CompletionParams,
  CompletionItem,
  CompletionItemKind,
  TextDocument,
  TextDocuments,
} from "vscode-languageserver";

import {
  completionList,
  getLineFragment,
} from "./serverUtilities";

const path = require("path");

function isFileOfInterest(document: TextDocument): boolean {
  const filename = path.basename(document.uri);
  if (filename.startsWith("vtest")) {
    return true;
  } else {
    return false;
  }
}

export function getCodedTestCompletionData(
  documents: TextDocuments,
  completionData: CompletionParams
): CompletionItem[] {
  let listToReturn: string[] = [];
  const document = documents.get(completionData.textDocument.uri);
  if (document && isFileOfInterest(document)) {
    const lineSoFar = getLineFragment(document, completionData.position).trim();
    if (lineSoFar.startsWith("vmock")) {
      listToReturn = ["unit1", "unit2", "unit3"];
    } else {
      listToReturn = [];
    }
  } else {
    listToReturn = ["error"];
  }
  return completionList(listToReturn, CompletionItemKind.Text);
}
