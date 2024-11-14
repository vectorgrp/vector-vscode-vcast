import * as vscode from "vscode";
import { errorLevel, vectorMessage } from "./messagePane";
import { getMCDCResultFile, getResultFileForTest } from "./vcastTestInterface";

const fs = require("fs");

// TBD TODAY - We switch txt to html ...
let htmlReportPanel: vscode.WebviewPanel | undefined = undefined;
function viewResultsReportVC(htmlFilePath: string) {
  // The stock VectorCAST HTML reports look ugly in VS Code so
  // we do a manual edits, and color changes.
  vectorMessage(`Report file path is: ${htmlFilePath}`);
  let htmlText = fs.readFileSync(htmlFilePath, "utf-8");
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
  const htmlFilePath = await getResultFileForTest(testID);
  if (fs.existsSync(htmlFilePath)) {
    vectorMessage(
      "Viewing results, result report path: '" + htmlFilePath + "'"
    );
    viewResultsReportVC(htmlFilePath);
  }
}

export async function viewMCDCReport(
  enviroPath: string,
  enviroName: string,
  unit: string,
  lineNumber: number
) {
  // make sure that a test is selected
  const htmlFilePath = await getMCDCResultFile(
    enviroPath,
    enviroName,
    unit,
    lineNumber
  );
  if (fs.existsSync(htmlFilePath)) {
    vectorMessage(
      "Viewing results, result report path: '" + htmlFilePath + "'"
    );
    viewResultsReportVC(htmlFilePath);
  }
}
