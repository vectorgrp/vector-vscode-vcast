// Test/specs/vcast.test.ts
import {
  type BottomBarPanel,
  type StatusBar,
  type TextEditor,
  type EditorView,
  type Workbench,
  type TreeItem,
  CustomTreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  getViewContent,
  findSubprogram,
  getTestHandle,
  findSubprogramMethod,
  editTestScriptFor,
  updateTestID,
  checkIfRequestInLogs,
  toggleDataServer,
  checkElementExistsInHTML,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";
import { checkForServerRunnability } from "../../../../unit/getToolversion";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  let statusBar: StatusBar;
  let useDataServer: boolean = true;

  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    editorView = workbench.getEditorView();
    process.env.E2E_TEST_ID = "0";
    let releaseIsSuitableForServer = await checkForServerRunnability();
    if (process.env.VCAST_USE_PYTHON || !releaseIsSuitableForServer) {
      useDataServer = false;
    }
  });

  it("test 1: should be able to load VS Code", async () => {
    await updateTestID();
    expect(await workbench.getTitleBar().getTitle()).toBe(
      "[Extension Development Host] vcastTutorial - Visual Studio Code"
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
      { timeout: TIMEOUT }
    );
    console.log("WAITING FOR TEST EXPLORER");
    await browser.waitUntil(async () =>
      (await outputView.getChannelNames())
        .toString()
        .includes("VectorCAST Test Explorer")
    );
    await outputView.selectChannel("VectorCAST Test Explorer");
    console.log("Channel selected");
    console.log("WAITING FOR LANGUAGE SERVER");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Starting the language server"),
      { timeout: TIMEOUT }
    );

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
  });

  it("should create New Test Script for myFirstTest - 2", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          await subprogram.expand();
          break;
        }
      }
    }

    if (!subprogram) {
      throw new Error("Subprogram 'manager' not found");
    }

    const subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Manager::PlaceOrder"
    );
    if (!subprogramMethod) {
      throw new Error("Subprogram method 'Manager::PlaceOrder' not found");
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }

    await editTestScriptFor(subprogramMethod, "DATABASE-MANAGER");

    const tab = (await editorView.openEditor(
      "DATABASE-MANAGER.tst"
    )) as TextEditor;

    let currentLine = await tab.getLineOfText("TEST.REQUIREMENT_KEY:FR20");
    await tab.moveCursor(currentLine, "TEST.REQUIREMENT_KEY:FR20".length + 1);
    await browser.keys([Key.Enter]);
    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.VALUE:manager.Manager::PlaceOrder.Seat:1"
    );

    await tab.moveCursor(
      currentLine,
      "TEST.VALUE:manager.Manager::PlaceOrder.Seat:1".length + 1
    );
    await browser.keys([Key.Enter]);
    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.VALUE:manager.Manager::PlaceOrder.Table:1"
    );
    await browser.keys([Key.Enter]);

    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.VALUE:manager.Manager::PlaceOrder.Order.Entree:Steak"
    );

    await browser.keys([Key.Enter]);
    currentLine += 1;
    await tab.setTextAtLine(currentLine, "TEST.END");

    await tab.save();

    // Check for server logs when loading scripts
    if (useDataServer) {
      const expectedLoadScriptLogs = [
        "received client request: runClicastCommand",
        "commandString: -eDATABASE-MANAGER -umanager -sManager::PlaceOrder test script create",
        "server return code: 0",
      ];
      const loadScriptLog = await checkIfRequestInLogs(
        13,
        expectedLoadScriptLogs
      );
      expect(loadScriptLog).toBe(true);
    }
  });

  it("should run myFirstTest and check its report", async () => {
    await updateTestID();
    console.log("Looking for Manager::PlaceOrder in the test tree");

    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem;
    let testHandle: TreeItem;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "myFirstTest",
          1
        );
        if (testHandle) {
          break;
        } else {
          throw new Error("Test handle not found for myFirstTest");
        }
      }
    }

    if (!subprogram) {
      throw new Error("Subprogram 'manager' not found");
    }

    console.log("Running myFirstTest");
    await testHandle.select();
    await (await (await testHandle.getActionButton("Run Test")).elem).click();

    // It is expected that the VectorCast Report WebView is the only existing WebView at the moment
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );

    let webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    let webview = webviews[0];

    await webview.open();

    expect(await checkElementExistsInHTML("Execution Results (PASS)")).toBe(
      true
    );
    expect(
      await checkElementExistsInHTML("Event 1 - Calling Manager::PlaceOrder")
    ).toBe(true);
    expect(
      await checkElementExistsInHTML(
        "Event 2 - Returned from Manager::PlaceOrder"
      )
    ).toBe(true);

    await expect($(".text-muted*=UUT")).toHaveText("UUT: manager.cpp");

    await expect($(".subprogram*=Manager")).toHaveText("Manager::PlaceOrder");

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);

    console.log("Validating info messages in output channel of the bottom bar");
    await bottomBar.maximize();
    await browser.waitUntil(async () =>
      (await (await bottomBar.openOutputView()).getText()).includes(
        "test explorer  [info]  Starting execution of test: myFirstTest ..."
      )
    );
    const outputViewText = await (await bottomBar.openOutputView()).getText();
    await bottomBar.restore();
    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Processing environment data for:");
      })
    ).not.toBe(undefined);

    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Viewing results, result report path");
      })
    ).not.toBe(undefined);
    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Creating web view panel");
      })
    ).not.toBe(undefined);

    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Setting webview text");
      })
    ).not.toBe(undefined);

    console.log(
      "Click on View Test Results in the Testing pane and check for report"
    );

    // Basically like clicking on "Run Test", just as another button in the contextmenu
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "myFirstTest",
          1
        );
        if (testHandle) {
          break;
        } else {
          throw new Error("Test handle not found for myFirstTest");
        }
      }
    }

    if (!subprogram) {
      throw new Error("Subprogram 'manager' not found");
    }

    const contextMenu = await testHandle.openContextMenu();
    await contextMenu.select("VectorCAST");
    const menuElement = await $("aria/View Test Results");
    await menuElement.click();

    webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    webview = webviews[0];

    await webview.open();

    // Check for the same report
    expect(await checkElementExistsInHTML("Execution Results (PASS)")).toBe(
      true
    );
    expect(
      await checkElementExistsInHTML("Event 1 - Calling Manager::PlaceOrder")
    ).toBe(true);
    expect(
      await checkElementExistsInHTML(
        "Event 2 - Returned from Manager::PlaceOrder"
      )
    ).toBe(true);

    await expect($(".text-muted*=UUT")).toHaveText("UUT: manager.cpp");

    await expect($(".subprogram*=Manager")).toHaveText("Manager::PlaceOrder");

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);

    // Check for server logs when running tests

    if (useDataServer) {
      const outputView = await bottomBar.openOutputView();

      /*******************************************************
       *                Server On + Run Tests                *
       *******************************************************/
      console.log("Checking test run logic for Sever mode.");
      const expectedRunTestsLogs = [
        "received client request: executeTest",
        "commandString: -lc -eDATABASE-MANAGER -umanager -sManager::PlaceOrder -tmyFirstTest execute run",
        "server return code: 0",
        "received client request: report for",
      ];
      const runTestsLog = await checkIfRequestInLogs(27, expectedRunTestsLogs);
      expect(runTestsLog).toBe(true);

      statusBar = workbench.getStatusBar();

      await browser.waitUntil(
        async () => (await statusBar.getItems()).includes("vDataServer On"),
        { timeout: TIMEOUT }
      );

      /*******************************************************
       *               Server Off + Run Tests                *
       *******************************************************/
      console.log("Turning Server off");
      await toggleDataServer(false);

      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes("VectorCAST Data Server exited successfully"),
        { timeout: TIMEOUT }
      );

      const expectedServerOfflineLogs = [
        " received shutdown request",
        "vcastDataServer is exiting",
      ];
      const serverOfflineLog = await checkIfRequestInLogs(
        10,
        expectedServerOfflineLogs
      );
      expect(serverOfflineLog).toBe(true);

      // Run test again
      await (await (await testHandle.getActionButton("Run Test")).elem).click();

      await outputView.clearText();

      // Let the run finish before changing the server state again
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes("Processing environment data for:"),
        { timeout: TIMEOUT }
      );

      // No new logs should be there ebcasue we shutdown the server --> check for the same logs
      const runTestsLogAfterSettingOffline = await checkIfRequestInLogs(
        10,
        expectedServerOfflineLogs
      );
      expect(runTestsLogAfterSettingOffline).toBe(true);

      /*******************************************************
       *             Server On again + Run Tests             *
       *******************************************************/

      console.log("Turning Server on again.");

      await toggleDataServer(true);

      // Check message pane for expected message
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes("Started VectorCAST Data Server"),
        { timeout: TIMEOUT }
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Server startup logs
      const expectedServerOnlineLogs = [
        "port:",
        "clicast:",
        "received ping request, responding 'alive'",
      ];
      const serverOnlineLog = await checkIfRequestInLogs(
        3,
        expectedServerOnlineLogs
      );
      expect(serverOnlineLog).toBe(true);

      // Run test again
      await (await (await testHandle.getActionButton("Run Test")).elem).click();
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes("Setting webview text"),
        { timeout: TIMEOUT }
      );

      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Server is now online again --> We should see the same logs as before
      const runTestsLogAfterSettingOnline = await checkIfRequestInLogs(
        27,
        expectedRunTestsLogs
      );
      expect(runTestsLogAfterSettingOnline).toBe(true);

      // We need to close the report at the end because otherwise manager.cpp will be opened on the second
      // editor page which then makes us not find manager.cpp
      await webview.close();
      await editorView.closeEditor("VectorCAST Report", 1);
    }
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
    const cppFolder = workspaceFolderSection.findItem("cpp");
    await (await cppFolder).select();

    const managerCpp = workspaceFolderSection.findItem("manager.cpp");
    await (await managerCpp).select();

    editorView = workbench.getEditorView();
    const tab = (await editorView.openEditor("manager.cpp")) as TextEditor;
    const RED_GUTTER = "/no-cover-icon";
    const GREEN_GUTTER = "/cover-icon";
    // Moving cursor to make sure coverage indicators are in view
    await tab.moveCursor(10, 3);
    console.log(
      "Validating that the RED gutter appears on line 10 in manager.cpp"
    );
    let lineNumberElement = await $(".line-numbers=10");
    let coverageDecoElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");
    let backgroundImageCSS =
      await coverageDecoElement.getCSSProperty("background-image");
    let backgroundImageURL = backgroundImageCSS.value;
    expect(backgroundImageURL.includes(RED_GUTTER)).toBe(true);

    await tab.moveCursor(38, 3);
    console.log(
      "Validating that the GREEN gutter appears on line 38 in manager.cpp"
    );
    lineNumberElement = await $(".line-numbers=38");
    coverageDecoElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");
    backgroundImageCSS =
      await coverageDecoElement.getCSSProperty("background-image");
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
