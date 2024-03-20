// test/specs/vcast.test.ts
import {
  BottomBarPanel,
  StatusBar,
  TextEditor,
  EditorView,
  CustomTreeItem,
  Workbench,
  TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  releaseCtrl,
  executeCtrlClickOn,
  expandWorkspaceFolderSectionInExplorer,
  clickOnButtonInTestingHeader,
  getGeneratedTooltipTextAt,
  getViewContent,
  findSubprogram,
  getTestHandle,
  findSubprogramMethod,
  openTestScriptFor,
  editTestScriptFor,
  deleteTest,
  updateTestID,
  cleanup
} from "../test_utils/vcast_utils";

import { exec, execSync } from "child_process";
import * as path from 'path';
import { promisify } from "node:util";
const promisifiedExec = promisify(exec);
describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  let statusBar: StatusBar;
  const TIMEOUT = 20000;
  before(async () => {
    workbench = await browser.getWorkbench();
    // opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    editorView = workbench.getEditorView();
    process.env["E2E_TEST_ID"] = "0";
  });

  it("test 1: should be able to load VS Code", async () => {
    await updateTestID();
    expect(await workbench.getTitleBar().getTitle()).toBe(
      "[Extension Development Host] vcastTutorial - Visual Studio Code",
    );
  });

  it("should activate vcastAdapter", async () => {
    await updateTestID();

    await browser.keys([Key.Control, Key.Shift, "p"]);
    // Typing Vector in the quick input box
    // This brings up VectorCAST Test Explorer: Configure
    // so just need to hit Enter to activate
    for (const character of "vector") {
      await browser.keys(character);
    }
    await browser.keys(Key.Enter);

    const activityBar = workbench.getActivityBar();
    const viewControls = await activityBar.getViewControls();
    for (const viewControl of viewControls) {
      console.log(await viewControl.getTitle());
    }
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();

    console.log("Waiting for VectorCAST activation");
    await $("aria/VectorCAST Test Pane Initialization");
    console.log("WAITING FOR TESTING");
    await browser.waitUntil(
      async () => (await activityBar.getViewControl("Testing")) !== undefined,
      { timeout: TIMEOUT },
    );
    console.log("WAITING FOR TEST EXPLORER");
    await browser.waitUntil(async () =>
      (await outputView.getChannelNames())
        .toString()
        .includes("VectorCAST Test Explorer")
    );
    await outputView.selectChannel("VectorCAST Test Explorer")
    console.log("Channel selected")
    console.log("WAITING FOR LANGUAGE SERVER");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Starting the language server"),
      { timeout: TIMEOUT },
    );

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
  });

  it("should create New Test Script for myFirstTest - 2", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem = undefined;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection,
        );
        if (subprogram) {
          await subprogram.expand();
          break;
        }
      }
    }
    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    const subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Manager::PlaceOrder",
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Manager::PlaceOrder' not found";
    }
    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }
    await editTestScriptFor(subprogramMethod, "DATABASE-MANAGER");

    const tab = (await editorView.openEditor(
      "DATABASE-MANAGER.tst",
    )) as TextEditor;

    let currentLine = await tab.getLineOfText("TEST.REQUIREMENT_KEY:FR20");
    await tab.moveCursor(
      currentLine,
      "TEST.REQUIREMENT_KEY:FR20".length + 1,
    );
    await browser.keys([Key.Enter]);
    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.VALUE:manager.Manager::PlaceOrder.Seat:1",
    );

    await tab.moveCursor(
      currentLine,
      "TEST.VALUE:manager.Manager::PlaceOrder.Seat:1".length + 1,
    );
    await browser.keys([Key.Enter]);
    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.VALUE:manager.Manager::PlaceOrder.Table:1",
    );
    await browser.keys([Key.Enter]);

    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.VALUE:manager.Manager::PlaceOrder.Order.Entree:Steak",
    );

    await browser.keys([Key.Enter]);
    currentLine += 1;
    await tab.setTextAtLine(currentLine, "TEST.END");

    await tab.save();

    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.loadTestScript");
    });
  });

  it("should run myFirstTest and check its report", async () => {
    await updateTestID();

    console.log("Looking for Manager::PlaceOrder in the test tree");

    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "myFirstTest",
          1,
        );
        if (testHandle) {
          break;
        } else {
          throw "Test handle not found for myFirstTest";
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Running myFirstTest");
    await testHandle.select();
    await (await (await testHandle.getActionButton("Run Test")).elem).click();

    // It is expected that the VectorCast Report WebView is the only existing WebView at the moment
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT },
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();

    await expect($("h4*=Execution Results (PASS)")).toHaveText(
      "Execution Results (PASS)",
    );
    await expect($(".event*=Event 1")).toHaveText(
      "Event 1 - Calling Manager::PlaceOrder",
    );

    await expect($(".event*=Event 2")).toHaveText(
      "Event 2 - Returned from Manager::PlaceOrder",
    );

    await expect($(".text-muted*=UUT")).toHaveText("UUT: manager.cpp");

    await expect($(".subprogram*=Manager")).toHaveText("Manager::PlaceOrder");

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);

    console.log("Validating info messages in output channel of the bottom bar");
    await bottomBar.maximize();
    await browser.waitUntil(async () =>
      (await (await bottomBar.openOutputView()).getText()).includes(
        "test explorer  [info]  Starting execution of test: myFirstTest ...",
      ),
    );
    const outputViewText = await (await bottomBar.openOutputView()).getText();
    await bottomBar.restore();
    expect(
      outputViewText.includes(
        "test explorer  [info]  Starting execution of test: myFirstTest ...",
      ),
    ).toBe(true);
    expect(
      outputViewText.includes(
        "test explorer  [info]  Test summary for: vcast:cpp/unitTests/DATABASE-MANAGER|manager.Manager::PlaceOrder.myFirstTest",
      ),
    ).toBe(true);
    expect(
      outputViewText.includes("test explorer  [info]  Status: passed"),
    ).toBe(true);

    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Execution Time:");
      }),
    ).not.toBe(undefined);

    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Processing environment data for:");
      }),
    ).not.toBe(undefined);

    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Viewing results, result report path");
      }),
    ).not.toBe(undefined);

    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Creating web view panel");
      }),
    ).not.toBe(undefined);

    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Setting webview text");
      }),
    ).not.toBe(undefined);
  });

  it("should verify coverage indicators for manager.cpp", async () => {
    await updateTestID();

    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    const explorerSideBarView = await explorerView?.openView();

    const workspaceFolderName = "vcastTutorial";
    const workspaceFolderSection = await explorerSideBarView
      .getContent()
      .getSection(workspaceFolderName.toUpperCase());
    console.log(await workspaceFolderSection.getTitle());
    await workspaceFolderSection.expand();

    const managerCpp = workspaceFolderSection.findItem("manager.cpp");
    await (await managerCpp).select();

    editorView = workbench.getEditorView();
    const tab = (await editorView.openEditor("manager.cpp")) as TextEditor;
    const RED_GUTTER = "/no-cover-icon";
    const GREEN_GUTTER = "/cover-icon";
    // moving cursor to make sure coverage indicators are in view
    await tab.moveCursor(10, 3);
    console.log(
      "Validating that the RED gutter appears on line 10 in manager.cpp",
    );
    let lineNumberElement = await $(".line-numbers=10");
    let coverageDecoElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");
    let backgroundImageCSS = await coverageDecoElement.getCSSProperty(
      "background-image",
    );
    let backgroundImageURL = backgroundImageCSS.value;
    expect(backgroundImageURL.includes(RED_GUTTER)).toBe(true);

    await tab.moveCursor(38, 3);
    console.log(
      "Validating that the GREEN gutter appears on line 38 in manager.cpp",
    );
    lineNumberElement = await $(".line-numbers=38");
    coverageDecoElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");
    backgroundImageCSS = await coverageDecoElement.getCSSProperty(
      "background-image",
    );
    backgroundImageURL = backgroundImageCSS.value;
    expect(backgroundImageURL.includes(GREEN_GUTTER)).toBe(true);
  });

  it("should verify coverage percentage shown on the Status Bar", async () => {
    await updateTestID();

    statusBar = workbench.getStatusBar();
    const statusBarInfos = await statusBar.getItems();
    expect(statusBarInfos.includes("Coverage: 14/41 (34%)")).toBe(true);

    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.loadTestScript");
    });
  });

});
