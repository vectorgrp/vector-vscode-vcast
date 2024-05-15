import * as vscode from "vscode";
import { Uri } from "vscode";

import { getListOfFilesWithCoverage } from "./vcastTestInterface";

// this class allows us to add decorations to the file explorer
// we currently use this to indicate what files have vcast coverage

function decorateExplorerOn(): boolean {
  let settings = vscode.workspace.getConfiguration("vectorcastTestExplorer");
  return settings.get("decorateExplorer", false);
}

// this is the class instance for the file decorator
// when it is null no decorations are applied
export var fileDecorator: TreeFileDecorationProvider | undefined = undefined;
export function updateExploreDecorations() {
  // called during initialization, and any time the user changes the option
  if (decorateExplorerOn()) {
    if (!fileDecorator) {
      fileDecorator = new TreeFileDecorationProvider();
    }
    fileDecorator.updateCoverageDecorations(getListOfFilesWithCoverage());
  } else {
    fileDecorator?.removeAllCoverageDecorations();
    fileDecorator = undefined;
  }
}

// from here: https://stackoverflow.com/questions/74449432/how-to-add-and-select-color-for-nodes-tree-view-items-in-explorer-view-in-my-vsc
export class TreeFileDecorationProvider
  implements vscode.FileDecorationProvider
{
  private disposables: Array<vscode.Disposable> = [];
  private filesWithCoverage: string[] = [];

  private readonly _onDidChangeFileDecorations: vscode.EventEmitter<
    Uri | Uri[]
  > = new vscode.EventEmitter<Uri | Uri[]>();
  readonly onDidChangeFileDecorations: vscode.Event<Uri | Uri[]> =
    this._onDidChangeFileDecorations.event;

  constructor() {
    this.disposables = [];
    this.disposables.push(vscode.window.registerFileDecorationProvider(this));
  }

  async addCoverageDecorationToFile(filePath: string): Promise<void> {
    // this should be called when you want to indicate that a file
    // has coverage in the file explorer tree

    // if this path is not in the list, add it
    if (this.filesWithCoverage.indexOf(filePath) == -1) {
      this.filesWithCoverage.push(filePath);

      const uri: Uri = vscode.Uri.file(filePath);
      this._onDidChangeFileDecorations.fire(uri);
    }
  }

  async updateCoverageDecorations(fileList: string[]) {
    // this function will replace the existing decorations
    await this.removeAllCoverageDecorations();

    // convenience function to update a list of files
    for (let filePath of fileList) {
      this.addCoverageDecorationToFile(filePath);
    }
  }

  async removeCoverageDecorationFromFile(filePath: string): Promise<void> {
    // this removes the decoration for one file
    const index = this.filesWithCoverage.indexOf(filePath);
    if (index > -1) {
      this.filesWithCoverage.splice(index, 1);

      const uri: Uri = vscode.Uri.file(filePath);
      this._onDidChangeFileDecorations.fire(uri);
    }
  }

  async removeAllCoverageDecorations(): Promise<void> {
    // this will spin through the list of decorated files and remove them
    // create a copy of the list so we can destroy the real list was we process each item
    const listCopy = [...this.filesWithCoverage];
    for (const filePath of listCopy) {
      // remove the first element from the list
      this.filesWithCoverage.shift();

      const uri: Uri = vscode.Uri.file(filePath);
      this._onDidChangeFileDecorations.fire(uri);
    }
  }

  async provideFileDecoration(
    uri: Uri
  ): Promise<vscode.FileDecoration | undefined> {
    const filePath: string = uri.fsPath;
    if (this.filesWithCoverage.includes(filePath)) {
      return {
        badge: "VC",
        //color: new vscode.ThemeColor("charts.red"),
        tooltip: "VectorCAST Coverage Exists",
      };
    } else return; // to get rid of the custom fileDecoration
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
