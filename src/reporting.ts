import * as vscode from "vscode";
import { vectorMessage } from "./messagePane";
import { getResultFileForTest } from "./vcastTestInterface";

const fs = require("fs");
const os = require("os");

function cleanHTML(htmlText: string) {
  // This function will remove the html
  // section that creates the left margin navigation
  // bar in the execution report.  This makes
  // the report look better in VS Code

  let lineList = htmlText.split(os.EOL);
  let returnText: string = "";
  let skipping = false;

  for (let line of lineList) {
    if (skipping) {
      if (line.includes("ExecutionResults/testcase_header")) {
        returnText += `
<style>
body {
    overflow-y: scroll;
    background-color: var(--vscode-editor-background);
    color: var(--vscode-foreground);
}

.test-action-header {
    background-color: var(--vscode-editorGroup-border);
}

.bs-callout.bs-callout-danger {
    border-left-width: 3px;
}

.bs-callout.bs-callout-success {
    border-left-width: 3px;
}

.bs-callout.bs-callout-warning {
    border-left-width: 3px;
    font-weight: bold;
}

tr:hover {
    background-color: var(--vscode-editor-background) !important;
}

.report-block {
    height: 100%;
    width: 100%;
    overflow: scroll;
}

.danger {
    background-color: var(--vscode-testing-iconFailed);
    color: black;
    font-weight: bold
}

.danger:hover {
    background-color: var(--vscode-testing-iconFailed) !important;
}

.success, .bg-success {
    background-color: var(--vscode-testing-iconPassed);
    color: black;
    font-weight: bold
}

.success:hover, .bg-success:hover {
    background-color: var(--vscode-testing-iconPassed) !important;
}

.warning, .bg-warning {
    background-color: var(--vscode-testing-iconQueued);
    color: black;
    font-weight: bold
}

.warning:hover, .bg-warning:hover {
    background-color: var(--vscode-testing-iconQueued) !important;
}
</style>`;
        returnText += line;
        skipping = false;
      }
    } else {
      if (line.includes('div id="title-bar"')) {
        skipping = true;
      }
      //default headings from VCAST is annoyingly big
      else if (line.includes("Execution Results (FAIL)")) {
        line = line.replace(
          "Execution Results (FAIL)",
          "<h4>Execution Results (FAIL)</h4>"
        );
        returnText += line;
      } else if (line.includes("Execution Results (PASS)")) {
        line = line.replace(
          "Execution Results (PASS)",
          "<h4>Execution Results (PASS)</h4>"
        );
        returnText += line;
      } else {
        returnText += line;
      }
    }
  }
  return returnText;
}

let htmlReportPanel: vscode.WebviewPanel | undefined = undefined;
function viewResultsReportVC(textFilePath: string) {
  // The stock VectorCAST HTML reports look ugly in VS Code so
  // we do a manual edits, and color changes.
  const htmlFilePath = textFilePath.replace(".txt", ".html");
  vectorMessage(`HTML report file path is: ${htmlFilePath}`);
  let htmlText = cleanHTML(fs.readFileSync(htmlFilePath, "utf-8"));
  // this displays the html report in a webview panel
  if (!htmlReportPanel) {
    vectorMessage("Creating web view panel ...");
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
    vectorMessage("Revealing webview panel ...");
    htmlReportPanel.reveal(vscode.ViewColumn.Two);
  }

  vectorMessage("Setting webview text ...");
  htmlReportPanel.webview.html = htmlText;
}

export function viewResultsReport(testID: string) {
  // make sure that a test is selected
  const textFilePath = getResultFileForTest(testID);
  vectorMessage("Viewing results, result report path: '" + textFilePath + "'");
  if (fs.existsSync(textFilePath)) {
    viewResultsReportVC(textFilePath);
  }
}
