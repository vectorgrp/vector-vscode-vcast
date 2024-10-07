import * as vscode from "vscode";
import { errorLevel, vectorMessage } from "./messagePane";
import { getResultFileForTest } from "./vcastTestInterface";
import { cleanHTML } from "./cleanHtml";

const fs = require("fs");

let htmlReportPanel: vscode.WebviewPanel | undefined = undefined;
function viewResultsReportVC(textFilePath: string) {
  // The stock VectorCAST HTML reports look ugly in VS Code so
  // we do a manual edits, and color changes.
  const htmlFilePath = textFilePath.replace(".txt", ".html");
  vectorMessage(`HTML report file path is: ${htmlFilePath}`);
  let htmlText = cleanHTML(fs.readFileSync(htmlFilePath, "utf-8"));
  // this displays the html report in a webview panel
  if (!htmlReportPanel) {
    vectorMessage("Creating web view panel ...", errorLevel.trace);
    htmlReportPanel = vscode.window.createWebviewPanel(
      "vcastReport",
      "VectorCAST Report",
      vscode.ViewColumn.Two,
      {}
    );
    htmlReportPanel.onDidDispose(() => {
      htmlReportPanel = undefined;
    });
  } else {
    vectorMessage("Revealing webview panel ...", errorLevel.trace);
    htmlReportPanel.reveal(vscode.ViewColumn.Two);
  }

  vectorMessage("Setting webview text ...", errorLevel.trace);
  htmlReportPanel.webview.html = htmlText;
}

export async function viewResultsReport(testID: string) {
  // make sure that a test is selected
  const textFilePath = await getResultFileForTest(testID);
  vectorMessage("Viewing results, result report path: '" + textFilePath + "'");
  if (fs.existsSync(textFilePath)) {
    viewResultsReportVC(textFilePath);
  }
}
