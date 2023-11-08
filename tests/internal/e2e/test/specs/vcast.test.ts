// test/specs/vcast.test.ts
import {
  BottomBarPanel,
  StatusBar,
  TextEditor,
  EditorView,
  CustomTreeItem,
  Workbench,
  TreeItem,
  ViewItem,
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
} from "../test_utils/vcast_utils";

import { exec } from "child_process";
import { promisify } from "node:util";
const promisifiedExec = promisify(exec);
describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  let statusBar: StatusBar;
  const TIMEOUT = 120000;
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

  it("should set default config file", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection = await expandWorkspaceFolderSectionInExplorer(
      "vcastTutorial",
    );

    const configFile = await workspaceFolderSection.findItem("CCAST_.CFG")
    await configFile.openContextMenu()
    await (await $("aria/Set as VectorCAST Configuration File")).click()
  });

  it("should create VectorCAST environment", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection = await expandWorkspaceFolderSectionInExplorer(
      "vcastTutorial",
    );
    const cppFolder = workspaceFolderSection.findItem("cpp");
    await (await cppFolder).select();

    let managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    let databaseCpp = await workspaceFolderSection.findItem("database.cpp");
    await executeCtrlClickOn(databaseCpp);
    await executeCtrlClickOn(managerCpp);
    await releaseCtrl();

    await databaseCpp.openContextMenu();
    await (await $("aria/Create VectorCAST Environment")).click();

    // making sure notifications are shown
    await (await $("aria/Notifications")).click();

    // this will timeout if VectorCAST notification does not appear, resulting in a failed test
    const vcastNotifSourceElem = await $(
      "aria/VectorCAST Test Explorer (Extension)",
    );
    const vcastNotification = await vcastNotifSourceElem.$("..");
    await (await vcastNotification.$("aria/Yes")).click();

    console.log(
      "Waiting for clicast and waiting for environment to get processed",
    );
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("Environment built Successfully"),
      { timeout: TIMEOUT },
    );

    console.log("Finished creating vcast environment");
    await browser.takeScreenshot();
    await browser.saveScreenshot(
      "info_finished_creating_vcast_environment.png",
    );
    // clearing all notifications
    await (await $(".codicon-notifications-clear-all")).click();
  });

  it("Creating another instance of test environment", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection = await expandWorkspaceFolderSectionInExplorer(
      "vcastTutorial",
    );

    // clearing output text before creating another test environment
    // this helps with simplifying event synchronization
    await (await bottomBar.openOutputView()).clearText();

    let managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    let databaseCpp = await workspaceFolderSection.findItem("database.cpp");
    await executeCtrlClickOn(databaseCpp);
    await executeCtrlClickOn(managerCpp);
    await releaseCtrl();

    await databaseCpp.openContextMenu();
    await (await $("aria/Create VectorCAST Environment")).click();

    // waiting for the dialog that handles duplicate environments
    // test fails if one of the following selectors times out
    await $("aria/Choose VectorCAST Environment Name");
    await $("aria/Directory: &quot;DATABASE-MANAGER&quot; already exists");
    const newEnvironmentName = "DATABASE-MANAGER2";

    for (const character of newEnvironmentName) {
      await browser.keys(character);
    }

    await browser.keys(Key.Enter);
    console.log(
      "Waiting for clicast and waiting for environment to get processed",
    );
    await (await (await bottomBar.openOutputView()).elem).click();
    await bottomBar.maximize()
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("Environment built Successfully"),
      { timeout: TIMEOUT },
    );
    await bottomBar.restore()
    
    const vcastTestingViewContent = await getViewContent("Testing");
    await (await vcastTestingViewContent.elem).click();
    const sections = await vcastTestingViewContent.getSections();
    const testExplorerSection = sections[0];
    const testEnvironments = await testExplorerSection.getVisibleItems();
    const duplicateEnvironmentName = "DATABASE-MANAGER2";
    for (const testEnvironment of testEnvironments) {
      const testEnvironmentTooltipText = await (
        testEnvironment as CustomTreeItem
      ).getTooltip();

      if (testEnvironmentTooltipText.includes(duplicateEnvironmentName)) {
        console.log("Deleting duplicate environment");
        // making sure notifications are shown
        await (await $("aria/Notifications")).click();
        const testEnvironmentContextMenu = await (
          testEnvironment as CustomTreeItem
        ).openContextMenu();
        await testEnvironmentContextMenu.select("VectorCAST");
        await (await $("aria/Delete Environment")).click();

        const vcastNotifSourceElem = await $(
          "aria/VectorCAST Test Explorer (Extension)",
        );
        const vcastNotification = await vcastNotifSourceElem.$("..");
        await (await vcastNotification.$("aria/Delete")).click();
        break;
      }
    }

    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("Successful deletion of environment DATABASE-MANAGER2"),
      { timeout: TIMEOUT },
    );
  });

  it("should open output log on button click", async () => {
    await updateTestID();

    console.log("closing Bottom Bar");
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(false);

    const buttonLabel = "View Message Panel (Ctrl+Shift+V)";
    await clickOnButtonInTestingHeader(buttonLabel);
    // See GH Issue #364, we need to click twice
    await clickOnButtonInTestingHeader(buttonLabel);
   
    console.log(
      "Verifying that VectorCAST Test Explorer is open in the bottom bar",
    );

    // Checking if the output opened in the bottom bar
    // with VectorCAST Test Explorer channel

    // closing all editors to avoid checking wrong select box
    await editorView.closeAllEditors()
    const selectBox = await $(".monaco-select-box");
    const selectedChannel = await selectBox.getValue();
    expect(selectedChannel).toBe("VectorCAST Test Explorer");
  });

  it("should open VectorCAST settings on button click", async () => {
    await updateTestID();

    console.log("closing Bottom Bar");
    bottomBar = workbench.getBottomBar();
    bottomBar.toggle(false);

    const buttonLabel = "Open settings";
    await clickOnButtonInTestingHeader(buttonLabel);

    console.log("Verifying that VectorCAST Settings is opened");
    const activeTab = await editorView.getActiveTab();
    expect(await activeTab.getTitle()).toBe("Settings");

    await $(
      ".setting-item-description*=Decorate files that have coverage in the File Explorer pane",
    );
    await editorView.closeEditor("Settings");
  });

  it("should create New Test Script for myFirstTest", async () => {
    await updateTestID();
 
    console.log("Opening Testing View");
    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem = undefined;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (! await vcastTestingViewSection.isExpanded())
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand()
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection,
        );
        if (subprogram) {
          if (! await subprogram.isExpanded())
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
    await openTestScriptFor(subprogramMethod);

    const tab = (await editorView.openEditor(
      "vcast-template.tst",
    )) as TextEditor;
    console.log("Getting content assist");
    // Need to activate contentAssist before getting the object
    // That way we avoid a timeout that is a result of
    // toggleContentAssist() implementation
    await browser.keys([Key.Ctrl, Key.Space]);
    const contentAssist = await tab.toggleContentAssist(true);

    const findWidget = await tab.openFindWidget();
    await findWidget.setSearchText("TEST.NAME:test-Manager::PlaceOrder");
    await findWidget.toggleReplace(true);
    await findWidget.setReplaceText("TEST.NAME:myFirstTest");
    await findWidget.replace();
    await browser.keys([Key.Escape]);

    let currentLine = await tab.getLineOfText("TEST.NAME:myFirstTest");
    await tab.moveCursor(
      currentLine,
      "TEST.NAME:myFirstTest".length + 1,
    );
    await browser.keys([Key.Enter]);
    currentLine += 1;
    
    await tab.setTextAtLine(
      currentLine,
      "TEST.REQUIREMENT_KEY:FR20 | Clearing a table resets orders for all seats",
    );
    
    await tab.moveCursor(
      currentLine,
      "TEST.REQUIREMENT_KEY:FR20 | Clearing a table resets orders for all seats".length + 1,
    );
    await browser.keys([Key.Enter]);
    

    currentLine = await tab.getLineOfText("TEST.VALUE");
    await tab.typeTextAt(currentLine, "TEST.VALUE".length + 1, ":");

    // Really important to wait until content assist appears
    await browser.waitUntil(
      async () => (await contentAssist.getItems()).length === 4,
    );

    console.log("validating content assist (LSE features) for TEST.VALUE:");
    expect(await contentAssist.hasItem("database")).toBe(true);
    expect(await contentAssist.hasItem("manager")).toBe(true);
    expect(await contentAssist.hasItem("USER_GLOBALS_VCAST")).toBe(true);
    expect(await contentAssist.hasItem("uut_prototype_stubs")).toBe(true);

    console.log(
      "validating content assist (LSE features) for TEST.VALUE:manager.",
    );
    await tab.typeTextAt(currentLine, "TEST.VALUE:".length + 1, "manager.");
    await browser.waitUntil(
      async () => (await contentAssist.getItems()).length === 8,
    );
    expect(await contentAssist.hasItem("<<GLOBAL>>")).toBe(true);
    expect(await contentAssist.hasItem("Manager::AddIncludedDessert")).toBe(
      true,
    );
    expect(await contentAssist.hasItem("Manager::AddPartyToWaitingList")).toBe(
      true,
    );
    expect(await contentAssist.hasItem("Manager::ClearTable")).toBe(true);
    expect(await contentAssist.hasItem("Manager::GetCheckTotal")).toBe(true);
    expect(await contentAssist.hasItem("Manager::GetNextPartyToBeSeated")).toBe(
      true,
    );
    expect(await contentAssist.hasItem("Manager::Manager")).toBe(true);
    expect(await contentAssist.hasItem("Manager::PlaceOrder")).toBe(true);

    console.log("Selecting Manager::PlaceOrder from content assist");
    await (await contentAssist.getItem("Manager::PlaceOrder")).select();

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

    // this produces invalid locator error somehow
    // const contMenu = await tab.openContextMenu()
    // const menuItem = await contMenu.getItem("Load Test Script into Environment")
    // await menuItem.select()

    // Loading test script directly for now
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
  });

  it("should edit Test Script and create mySecondTest", async () => {
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
    const reqTooltipText = await getGeneratedTooltipTextAt(currentLine, "TEST.REQUIREMENT_KEY:FR20".length - 1, tab);
    console.log(reqTooltipText);
    expect(reqTooltipText).toContain("Clearing a table resets orders for all seats");
    expect(reqTooltipText).toContain("Clearing a table clears the orders for all seats of the table within the table database.");

    const findWidget = await tab.openFindWidget();
    await findWidget.setSearchText("TEST.NAME:myFirstTest");
    await findWidget.toggleReplace(true);
    await findWidget.setReplaceText("TEST.NAME:mySecondTest");
    await findWidget.replace();
    await findWidget.close();

    await bottomBar.toggle(false);
    const lastValueLineInPreviousTest =
      "TEST.VALUE:manager.Manager::PlaceOrder.Order.Entree:Steak";
    currentLine = await tab.getLineOfText(lastValueLineInPreviousTest);
    await tab.moveCursor(currentLine, lastValueLineInPreviousTest.length + 1);
    await browser.keys(Key.Enter);
    await tab.save();
    currentLine += 1;
    // not evaluating LSE, so setting text is sufficent and faster than typing
    await tab.setTextAtLine(
      currentLine,
      "TEST.STUB:database.DataBase::GetTableRecord",
    );
    await tab.moveCursor(
      currentLine,
      "TEST.STUB:database.DataBase::GetTableRecord".length + 1,
    );
    await browser.keys(Key.Enter);

    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.STUB:database.DataBase::UpdateTableRecord",
    );
    await tab.moveCursor(
      currentLine,
      "TEST.STUB:database.DataBase::UpdateTableRecord".length + 1,
    );
    await browser.keys(Key.Enter);

    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.VALUE:database.DataBase::GetTableRecord.Data[0].CheckTotal:14",
    );
    console.log("CURRENT LINE");
    console.log(currentLine);
    await tab.moveCursor(
      currentLine,
      "TEST.VALUE:database.DataBase::GetTableRecord.Data[0].CheckTotal:14"
        .length + 1,
    );
    await browser.keys(Key.Enter);

    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.EXPECTED:database.DataBase::UpdateTableRecord.Data[0].CheckTotal:14",
    );
    await tab.save();
    await bottomBar.toggle(true);
    // this produces invalid locator error somehow
    // await tab.openContextMenu()
    // Loading test script directly for now
    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.loadTestScript");
    });
  });

  it("should run mySecondTest and check its report", async () => {
    await updateTestID();

    console.log("Looking for Manager::PlaceOrder in the test tree");

    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        if (!await subprogram.isExpanded())
          await subprogram.expand()
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "mySecondTest",
          2,
        );
        if (testHandle) {
          break;
        } else {
          throw "Test handle not found for mySecondTest";
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Running mySecondTest");
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

    await expect($("h4*=Execution Results (FAIL)")).toHaveText(
      "Execution Results (FAIL)",
    );
    await expect($(".event*=Event 1")).toHaveText(
      "Event 1 - Calling Manager::PlaceOrder",
    );

    await expect($(".event*=Event 2")).toHaveText(
      "Event 2 - Stubbed DataBase::GetTableRecord",
    );

    await expect($(".event*=Event 3")).toHaveText(
      "Event 3 - Stubbed DataBase::UpdateTableRecord",
    );

    await expect($(".event*=Event 4")).toHaveText(
      "Event 4 - Returned from Manager::PlaceOrder",
    );

    await expect($(".text-muted*=UUT: manager.cpp")).toHaveText(
      "UUT: manager.cpp",
    );

    await expect($(".text-muted*=UUT: database.cpp")).toHaveText(
      "UUT: database.cpp",
    );

    await expect($(".subprogram*=Manager")).toHaveText("Manager::PlaceOrder");

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);

    console.log("Validating info messages in output channel of the bottom bar");
    await bottomBar.maximize();
    await browser.waitUntil(async () =>
      (await (await bottomBar.openOutputView()).getText()).includes(
        "test explorer  [info]  Starting execution of test: mySecondTest ...",
      ),
    );

    const outputViewText = await (await bottomBar.openOutputView()).getText();
    await bottomBar.restore();
    expect(
      outputViewText.includes(
        "test explorer  [info]  Starting execution of test: mySecondTest ...",
      ),
    ).toBe(true);
    expect(
      outputViewText.includes(
        "test explorer  [info]  Test summary for: vcast:cpp/unitTests/DATABASE-MANAGER|manager.Manager::PlaceOrder.mySecondTest",
      ),
    ).toBe(true);
    expect(
      outputViewText.includes("test explorer  [info]  Status: failed"),
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

  it("should edit Test Script and create myThirdTest", async () => {
    await updateTestID();
    // here not clicking on Edit test script
    // in order to be consistent with the demo
    editorView = workbench.getEditorView();
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "DATABASE-MANAGER.tst",
    );

    const tab = (await editorView.openEditor(
      "DATABASE-MANAGER.tst",
    )) as TextEditor;
    // closing bottom bar so that findWidget would find text that would otherwise be occluded
    await bottomBar.toggle(false);
    const findWidget = await tab.openFindWidget();
    await findWidget.setSearchText("TEST.NAME:mySecondTest");
    await findWidget.toggleReplace(true);
    await findWidget.setReplaceText("TEST.NAME:myThirdTest");
    await findWidget.replace();
    await findWidget.toggleReplace(false);
    await findWidget.close();

    const expectedValueLineFromPreviousTest =
      "TEST.EXPECTED:database.DataBase::UpdateTableRecord.Data[0].CheckTotal:14";
    const startingLineNumber = await tab.getLineOfText(
      expectedValueLineFromPreviousTest,
    );
    await tab.setTextAtLine(
      startingLineNumber,
      "TEST.EXPECTED:database.DataBase::UpdateTableRecord.Data[0].CheckTotal:28",
    );
    await tab.save();

    // this produces invalid locator error somehow
    // await tab.openContextMenu()
    // Loading test script directly for now
    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.loadTestScript");
    });
    await bottomBar.toggle(true);
    await bottomBar.openOutputView();
  });

  it("should check TEST.NOTES autocomplete and related warnings", async () => {
    await updateTestID();

    // here not clicking on Edit test script
    // in order to be consistent with the demo
    editorView = workbench.getEditorView();
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "DATABASE-MANAGER.tst",
    );

    const tab = (await editorView.openEditor(
      "DATABASE-MANAGER.tst",
    )) as TextEditor;
    // closing bottom bar so that findWidget would find text that would otherwise be occluded
    await bottomBar.toggle(false);
    const startingLineNumber = await tab.getLineOfText("TEST.NOTES:");
    await tab.setTextAtLine(startingLineNumber, " ");
    await tab.setTextAtLine(startingLineNumber + 1, " ");
    await tab.save();

    await tab.typeTextAt(startingLineNumber, 1, "TEST.NOTES:");
    await tab.save();
    // TEST.END_NOTES: should appear automatically
    const endNotesLineNumber = await tab.getLineOfText("TEST.END_NOTES:");
    // line number is -1 if TEST.END_NOTES: is not found
    expect(endNotesLineNumber).not.toBe(-1);
    expect(endNotesLineNumber).toBe(startingLineNumber + 2);

    const lineInsideTestNotes = startingLineNumber + 1;
    await tab.setTextAtLine(lineInsideTestNotes, "TEST.");

    const expectedProblemText = 'Commands cannot be nested in a "NOTES" block';
    const problemsView = await bottomBar.openProblemsView();
    await browser.waitUntil(
      async () => (await problemsView.getAllMarkers()).length > 0,
      { timeout: TIMEOUT },
    );
    const problemMarkers = await problemsView.getAllMarkers();
    // problem markers can appear for new features
    let nestedCommandProblemFound = false;
    for (const problem of problemMarkers[0].problems) {
      const problemText = await problem.getText();
      console.log(problemText);
      if (problemText.includes(expectedProblemText)) {
        nestedCommandProblemFound = true;
        break;
      }
    }
    expect(nestedCommandProblemFound).toBe(true);

    await tab.elem.click();
    await tab.setTextAtLine(lineInsideTestNotes, " ");
    await tab.save();
  });

  it("should run myThirdTest and check its report", async () => {
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
          "myThirdTest",
          3,
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

    console.log("Running myThirdTest");
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
      "Event 2 - Stubbed DataBase::GetTableRecord",
    );

    await expect($(".event*=Event 3")).toHaveText(
      "Event 3 - Stubbed DataBase::UpdateTableRecord",
    );

    await expect($(".event*=Event 4")).toHaveText(
      "Event 4 - Returned from Manager::PlaceOrder",
    );

    await expect($(".text-muted*=UUT: manager.cpp")).toHaveText(
      "UUT: manager.cpp",
    );

    await expect($(".text-muted*=UUT: database.cpp")).toHaveText(
      "UUT: database.cpp",
    );

    await expect($(".subprogram*=Manager")).toHaveText("Manager::PlaceOrder");

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);

    console.log("Validating info messages in output channel of the bottom bar");
    await bottomBar.maximize();
    await browser.waitUntil(async () =>
      (await (await bottomBar.openOutputView()).getText()).includes(
        "test explorer  [info]  Starting execution of test: myThirdTest ...",
      ),
    );
    const outputViewText = await (await bottomBar.openOutputView()).getText();
    await bottomBar.restore();
    expect(
      outputViewText.includes(
        "test explorer  [info]  Starting execution of test: myThirdTest ...",
      ),
    ).toBe(true);
    expect(
      outputViewText.includes(
        "test explorer  [info]  Test summary for: vcast:cpp/unitTests/DATABASE-MANAGER|manager.Manager::PlaceOrder.myThirdTest",
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

  it("should validate turning off automatic report generation", async () => {
    await updateTestID();
    console.log("Looking for Manager::PlaceOrder in the test tree");

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const settingsEditor = await workbench.openSettings();
    await settingsEditor.findSetting(
      "vectorcastTestExplorer.showReportOnExecute",
    );
    // only one setting in search results, so the current way of clicking is correct
    await (await settingsEditor.checkboxSetting$).click();
    // The following would have been cleaner but returns un undefined setting object:
    // const setting = await settingsEditor.findSetting("vectorcastTestExplorer.showReportOnExecute");
    // expect(setting).not.toBe(undefined)
    // await setting.setValue(false)

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
          "myThirdTest",
          3,
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

    console.log("Running myThirdTest");
    await testHandle.select();
    await (await (await testHandle.getActionButton("Run Test")).elem).click();

    await bottomBar.maximize();
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText()).includes(
          "test explorer  [info]  Status: passed",
        ),
      { timeout: TIMEOUT },
    );
    await bottomBar.restore();

    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(0);

    await workbench.openSettings();
    // only one setting in search results, so the current way of clicking is correct
    await (await settingsEditor.checkboxSetting$).click();
  });

  it("should add COMPOUND TEST and validate related LSE features", async () => {
    await updateTestID();

    console.log("Looking for Compound Tests in the test tree");

    console.log("Opening Testing View");
    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem = undefined;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        subprogram = await findSubprogram(
          "Compound Tests",
          vcastTestingViewContentSection,
        );
        if (subprogram) {
          await subprogram.expand();
          break;
        }
      }
    }
    if (!subprogram) {
      throw "Subprogram 'Compound Tests' not found";
    }

    await openTestScriptFor(subprogram as CustomTreeItem);

    const tab = (await editorView.openEditor(
      "vcast-template.tst",
    )) as TextEditor;
    // Need to activate contentAssist before getting the object
    // That way we avoid a timeout that is a result of
    // toggleContentAssist() implementation (if using contentAssist() here)
    // await browser.keys([Key.Ctrl, Key.Space])
    // const contentAssist = await tab.toggleContentAssist(true);

    const findWidget = await tab.openFindWidget();
    await findWidget.setSearchText("TEST.VALUE");
    await findWidget.toggleReplace(true);
    await findWidget.setReplaceText("TEST.SLOT");
    await findWidget.replace();
    await findWidget.close();

    let currentLine = await tab.getLineOfText("TEST.SLOT");

    await tab.setTextAtLine(
      currentLine,
      "TEST.SLOT:1,manager,Manager::PlaceOrder,1,myFirstTest",
    );
    await browser.keys(Key.Enter);
    await tab.save();

    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.SLOT:2,manager,Manager::PlaceOrder,1,mySecondTest",
    );
    await tab.save();

    await browser.keys(Key.Enter);
    await tab.save();
    currentLine += 1;
    await tab.setTextAtLine(currentLine, "TEST.END");
    await tab.save();
    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.loadTestScript");
    });
  });

  it("should run COMPOUND Test and check its report", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand()
      subprogram = await findSubprogram(
        "Compound Tests",
        vcastTestingViewSection,
      );
      if (subprogram) {
        await subprogram.expand();
        testHandle = await findSubprogramMethod(
          subprogram,
          "test-<<COMPOUND>>",
        );

        if (testHandle) {
          break;
        } else {
          throw "Test handle not found for Compound Test";
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Running Compound Test");
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
    await expect($(".event*=Event 1")).toHaveText(
      "Event 1 - Calling Manager::PlaceOrder",
    );

    await expect($(".event*=Event 2")).toHaveText(
      "Event 2 - Returned from Manager::PlaceOrder",
    );

    await expect($(".text-muted*=UUT: manager.cpp")).toHaveText(
      "UUT: manager.cpp",
    );

    await expect($(".subprogram*=Manager")).toHaveText("Manager::PlaceOrder");

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });

  it("should prepare for debugging", async () => {
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

    const cppFolder = workspaceFolderSection.findItem(".vscode");
    await (await cppFolder).select();

    const launchConfig = workspaceFolderSection.findItem("launch.json");
    await (await (await launchConfig).elem).click();
    await (await launchConfig).openContextMenu();
    await (await $("aria/VectorCAST: Add Launch Configuration")).click();

    console.log("Validating that debug launch configuration got generated");
    const debugConfigTab = (await editorView.openEditor(
      "launch.json",
    )) as TextEditor;

    await browser.waitUntil(
      async () => (await debugConfigTab.getText()) !== "",
      { timeout: TIMEOUT },
    );

    const allTextFromDebugConfig = await debugConfigTab.getText();
    expect(allTextFromDebugConfig.includes("configurations")).toBe(true);
    expect(allTextFromDebugConfig.includes("VectorCAST Harness Debug"));

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
          3,
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

    console.log("Debugging myFirstTest");
    console.log("Clicking on Debug Test button");
    await testHandle.select();
    await (await (await testHandle.getActionButton("Debug Test")).elem).click();
    console.log("Validating debug notifications");

    const debugNotificationText =
      "aria/Ready for debugging, choose launch configuration: &quot;VectorCAST Harness Debug&quot; ...";
    // this will timeout if debugger is not ready and/or debugger notification text is not shown
    await $(debugNotificationText);

    console.log("Waiting for manager_vcast.cpp to be open");
    // this times out if manager_vcast.cpp is not ready
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "manager_vcast.cpp",
      { timeout: TIMEOUT },
    );
    const activeTab = await editorView.getActiveTab();
    const activeTabTitle = await activeTab.getTitle();
    console.log(activeTabTitle);
    expect(activeTabTitle).toBe("manager_vcast.cpp");

    console.log("Finished creating debug configuration");
  });

  it("Verifies that gutter decorations dissapear when we edit manager.cpp", async () => {
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
    // moving cursor to make sure coverage indicators are in view
    await tab.moveCursor(10, 23);
    console.log("Editing manager.cpp to trigger removing coverage decorators");
    await browser.keys(Key.Enter);
    await tab.save();
    console.log(
      "Verifying that the coverage decorators got removed after file edit",
    );

    statusBar = workbench.getStatusBar();
    // Need to wait until status bar updates for gutters to actually disappear
    await browser.waitUntil(
      async () =>
        (await statusBar.getItems()).includes("Coverage Out of Date") === true,
    );

    const lineNumberElement = await $(".line-numbers=10");
    const coverageDecoElementHTML = await (
      await lineNumberElement.parentElement()
    ).getHTML();
    expect(coverageDecoElementHTML.includes("codicon")).toBe(false);
    expect(coverageDecoElementHTML.includes("TextEditorDecorationType")).toBe(
      false,
    );
  });

  it("should verify coverage info in the Status Bar is Coverage Out of Date", async () => {
    await updateTestID();

    statusBar = workbench.getStatusBar();
    const statusBarInfos = await statusBar.getItems();
    expect(statusBarInfos.includes("Coverage Out of Date")).toBe(true);
  });

  it("should validate test deletion", async () => {
    await updateTestID();

    console.log("Looking for Manager::PlaceOrder in the test tree");
    let vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand()
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "myThirdTest",
          3,
        );
        if (testHandle) {
          break;
        } else {
          throw "Test handle not found for myThirdTest";
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }
    console.log("Prepared test deletion");
    await deleteTest(testHandle as CustomTreeItem);

    console.log("Deleted test, validating");

    await subprogram.expand();
    const customSubprogramMethod = await findSubprogramMethod(
      subprogram,
      "Manager::PlaceOrder",
    );
    if (!await customSubprogramMethod.isExpanded()) {
      await customSubprogramMethod.expand()
    }

    console.log(`Waiting until ${"myThirdTest"} disappears from the test tree`);
    // timeout on the following wait indicates unsuccessful test deletion
    await browser.keys([Key.Ctrl, "R"])

    await browser.waitUntil(
      async () => (await customSubprogramMethod.getChildren()).length == 2,
    );

    for (const testHandle of await customSubprogramMethod.getChildren()) {
      expect(
        await (await (testHandle as CustomTreeItem).elem).getText(),
      ).not.toBe("myThirdTest");
    }

  });

  it("should build VectorCAST environment from .env", async () => {
    await updateTestID();
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    await (await bottomBar.openOutputView()).clearText()
    
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection = await expandWorkspaceFolderSectionInExplorer(
      "vcastTutorial",
    );
    
    await workspaceFolderSection.expand();
    const vceFile = await workspaceFolderSection.findItem("DATABASE-MANAGER-test.env");
    const vceMenu = await vceFile.openContextMenu()
    await vceMenu.select("Build VectorCAST Environment")
    await bottomBar.maximize()
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("Environment built Successfully"),
      { timeout: TIMEOUT },
    );

  });

  it("should open VectorCAST from .vce", async () => {
    await updateTestID();
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection = await expandWorkspaceFolderSectionInExplorer(
      "vcastTutorial",
    );

    await workspaceFolderSection.expand();
    const vceFile = await workspaceFolderSection.findItem("DATABASE-MANAGER.vce");
    const vceMenu = await vceFile.openContextMenu()
    await vceMenu.select("Open VectorCAST Environment")
   
    let checkVcastQtCmd = "ps -ef";
    if (process.platform == "win32") checkVcastQtCmd = "tasklist";
    
    {
      const { stdout, stderr } = await promisifiedExec(checkVcastQtCmd);
      if (stderr) {
        console.log(stderr);
        throw `Error when running ${checkVcastQtCmd}`;
      }
      expect(stdout).toContain("vcastqt")
    }
    
    let stopVcastCmd = "pkill vcastqt"
    if (process.platform == "win32") stopVcastCmd = `taskkill /IM "vcastqt.exe" /F`;
    {
      const { stdout, stderr } = await promisifiedExec(stopVcastCmd);
      if (stderr) {
        console.log(stderr);
        throw `Error when running ${stopVcastCmd}`;
      }
      
    }

  });
});
