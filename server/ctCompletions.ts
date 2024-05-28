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
  completionData: CompletionParams
): CompletionItem[] {
  // TBD today, need to associate an enviroPath with the script
  // Is there away to have shared memory between client and server
  // or a way to send updates to the server?
  const enviroPath = "C:/RDS/VectorCAST/coded_mock/unitTestts/DEMO1";

  let listToReturn: string[] = [];
  const document = documents.get(completionData.textDocument.uri);
  if (document) {
    const lineSoFar = getLineFragment(
      document,
      completionData.position
    ).trimEnd();
    console.log(`saw: ${lineSoFar}`);

    // Identify lines of interest
    if (
      lineSoFar.startsWith("void vmock") &&
      (lineSoFar.endsWith("_") || lineSoFar.endsWith("("))
    ) {
      // TBD today need to get the parameter profile for the stubbed function
      const jsonData = getChoiceDataFromPython(enviroPath, lineSoFar);
      listToReturn = jsonData.choicList;
    }
  }
  return completionList(listToReturn, CompletionItemKind.Text);
}
