

import {
    CompletionParams,
    CompletionItemKind,
    TextDocuments,
  } from "vscode-languageserver";

  import {
    completionList,
    getLineFragment,
    getTriggerFromContext,
  } from "./serverUtilities";


// TBD
// - Can we get a list of coded test files so that we only process those?
//   or should we check the contents of the file somwhow to figure this out?
// - 

export function getCodedTestCompletionData(
    documents: TextDocuments,
    completionData: CompletionParams,
    ) {

    const document = documents.get(completionData.textDocument.uri);

    if (document) {

      const lineSoFar = getLineFragment(document, completionData.position).trim();
      if (lineSoFar.startsWith ("VSTUB")) {
         const context = completionData.context;
         const trigger =  getTriggerFromContext(context);
         if (trigger == "(" || lineSoFar.endsWith("(")) {
            // TBD: get unitNames from the dataAPI
            const unitNames = ["manager", "database"];
            return completionList(
                unitNames,
                CompletionItemKind.Text
            );
         }
      }
    }
    return [];

}
