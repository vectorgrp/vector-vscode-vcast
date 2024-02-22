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

  it("should enable coded testing", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const settingsEditor = await workbench.openSettings();
    await settingsEditor.findSetting(
      "vectorcastTestExplorer.enableCodedTesting",
    );
    // only one setting in search results, so the current way of clicking is correct
    await (await settingsEditor.checkboxSetting$).click();
    await browser.takeScreenshot();
    await browser.saveScreenshot(
      "info_enabled_code_testing.png",
    );
    await workbench.getEditorView().closeAllEditors()
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
    await browser.takeScreenshot()
    await browser.saveScreenshot("settings_screen.png")
    await $(
      ".setting-item-description*=Decorate files that have coverage in the File Explorer pane",
    );
    await editorView.closeEditor("Settings");
  });

  it("should generate and run template test", async () => {
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

    let subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Coded Tests",
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Coded Tests' not found";
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }
    
    let ctxMenu = await subprogramMethod.openContextMenu()

    await ctxMenu.select("VectorCAST");
    let menuElem = await $("aria/Generate New Coded Test File");
    await menuElem.click();

    await (await $("aria/Save Code Test File")).click()
    for (const character of "TestFiles/manager-template.cpp") {
      await browser.keys(character);
    }
    
    await browser.keys(Key.Enter);
    
    await bottomBar.openOutputView()
    await browser.takeScreenshot()
    await browser.saveScreenshot("after_menu.png")
    await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleFixtureTestCase",
      2,
    );

    const testHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleTestCase",
      2,
    );

    ctxMenu = await testHandle.openContextMenu()
    await ctxMenu.select("VectorCAST");
    menuElem = await $("aria/Edit Coded Test");
    await menuElem.click();
    await browser.takeScreenshot()
    await browser.saveScreenshot("after_edit.png")

    const editorView = workbench.getEditorView()
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "manager-template.cpp",
    );

    const problemsView = await bottomBar.openProblemsView()
    const problemMarkers = await problemsView.getAllMarkers()
    expect(problemMarkers.length).toBe(0)

    const runButton = await testHandle.getActionButton("Run Test")
    await runButton.elem.click()
    
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
      "Event 1 - Calling coded_tests_driver",
    );

    await expect($(".event*=Event 2")).toHaveText(
      "Event 2 - Returned from coded_tests_driver",
    );
    await webview.close()

    
    await editorView.closeAllEditors()
    
  });

  it("should check the debug prep", async () => {
    await updateTestID();
    
    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        if (!await subprogram.isExpanded())
          await subprogram.expand()
          console.log("Getting test handle")
          testHandle = await getTestHandle(
            subprogram,
            "Coded Tests",
            "managerTests.ExampleTestCase",
            2,
          );
        if (testHandle) {
          break;
        } else {
          throw "Test handle not found for managerTests.ExampleTestCase";
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Running debug prep");
    await testHandle.select();

    const debugButton = await testHandle.getActionButton("Debug Test")
    console.log("Showing generated debug configuration")
    await debugButton.elem.click()

    const editorView = workbench.getEditorView()
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

    console.log("Showing instrumented file")
    await debugButton.elem.click()
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "manager_exp_inst_driver.c",
      { timeout: TIMEOUT },
    );
    const activeTab = await editorView.getActiveTab();
    const activeTabTitle = await activeTab.getTitle();
    console.log(activeTabTitle);
    expect(activeTabTitle).toBe("manager_exp_inst_driver.c");
    
    const activeTabTextEditor = await editorView.openEditor("manager_exp_inst_driver.c") as TextEditor
    const selectedText = await activeTabTextEditor.getSelectedText()
    console.log(selectedText)
    expect(selectedText).toHaveTextContaining("class Test_managerTests_realTest")
    await editorView.closeAllEditors()

    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection = await expandWorkspaceFolderSectionInExplorer(
      "vcastTutorial",
    );

    let managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    await managerCpp.select()
    
  });

  it("should delete Coded Tests", async () => {
    await updateTestID();

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

    let subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Coded Tests",
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Coded Tests' not found";
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }
    
    let ctxMenu = await subprogramMethod.openContextMenu()

    await ctxMenu.select("VectorCAST");
    let menuElem = await $("aria/Remove Coded Tests");
    await menuElem.click();

    const bottomBar = workbench.getBottomBar()
    const outputView = await bottomBar.openOutputView()
    
    await browser.waitUntil(
      async () => ((await outputView.getText()).toString().includes("Deleting tests for node")),
      { timeout: TIMEOUT },
    );
    const outputText = (await outputView.getText()).toString()
    console.log(outputText)
    expect(outputText.includes("Deleting tests for node:")).toBe(true)
    
    await browser.waitUntil(
      async () => (((await outputView.getText()).at(-1)).toString().includes("Processing environment data for:")),
      { timeout: TIMEOUT },
    );
    await outputView.clearText()
  });

  it("should add a coded test file with a compile error", async () => {
    await updateTestID();

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

    let subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Coded Tests",
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Coded Tests' not found";
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }
    
    let ctxMenu = await subprogramMethod.openContextMenu()

    await ctxMenu.select("VectorCAST");
    let menuElem = await $("aria/Add Existing Coded Test File");
    await menuElem.click();


    await (await $("aria/Select Coded Test File")).click()
    for (const character of "TestFiles/manager-Tests.cpp") {
      await browser.keys(character);
    }
    
    await browser.keys(Key.Enter);
    
    await bottomBar.openOutputView()
    await browser.takeScreenshot()
    await browser.saveScreenshot("after_menu_existing.png")

    let currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleFixtureTestCase",
      5,
    );
    expect(currentTestHandle).not.toBe(undefined)

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleTestCase",
      5,
    );
    
    expect(currentTestHandle).not.toBe(undefined)

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.realTest",
      5,
    );
    
    expect(currentTestHandle).not.toBe(undefined)

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.fakeTest",
      5,
    );
    
    expect(currentTestHandle).not.toBe(undefined)

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.compileErrorTest",
      5,
    );
    expect(currentTestHandle).not.toBe(undefined)

    const editorView = workbench.getEditorView()
    const openTabs = await editorView.getOpenTabs()
    let titles: string[] = []
    for (const tab of openTabs) {
      titles.push(await tab.getTitle())
    }
    const expectedOpenTabTitles: string[] = ["manager-Tests.cpp", "ACOMPILE.LIS"]
    for (const expectedTitle of expectedOpenTabTitles) {
      expect(expectedOpenTabTitles.includes(expectedTitle)).toBe(true)
    }

    const sourceFileTab = await editorView.openEditor("manager-Tests.cpp") as TextEditor
    const line = await sourceFileTab.getLineOfText("compile-error-here")
    await sourceFileTab.setTextAtLine(line, "")
    await sourceFileTab.save()
    // await editorView.closeAllEditors()
  });


  it("should delete Coded Tests", async () => {
    await updateTestID();

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

    let subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Coded Tests",
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Coded Tests' not found";
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }
    
    let ctxMenu = await subprogramMethod.openContextMenu()

    await ctxMenu.select("VectorCAST");
    let menuElem = await $("aria/Remove Coded Tests");
    await menuElem.click();

    const bottomBar = workbench.getBottomBar()
    const outputView = await bottomBar.openOutputView()
    
    await browser.waitUntil(
      async () => ((await outputView.getText()).toString().includes("Deleting tests for node")),
      { timeout: TIMEOUT },
    );
    const outputText = (await outputView.getText()).toString()
    console.log(outputText)
    expect(outputText.includes("Deleting tests for node:")).toBe(true)
    
    await browser.waitUntil(
      async () => (((await outputView.getText()).at(-1)).toString().includes("Processing environment data for:")),
      { timeout: TIMEOUT },
    );
    await outputView.clearText()
  });

  it("should add a coded test file without the compile error", async () => {
    await updateTestID();

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

    let subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Coded Tests",
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Coded Tests' not found";
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }
    
    let ctxMenu = await subprogramMethod.openContextMenu()

    await ctxMenu.select("VectorCAST");
    let menuElem = await $("aria/Add Existing Coded Test File");
    await menuElem.click();


    // await (await $("aria/Select Coded Test File")).click()
    const textbox = await $("aria/Select Coded Test File")
    await textbox.click()
    // console.log(await textbox.getText())
    await browser.keys(Key.End)
    for (const character of "manager-Tests.cpp") {
      await browser.keys(character);
    }
    
    await browser.keys(Key.Enter);
    
    await bottomBar.openOutputView()
    await browser.takeScreenshot()
    await browser.saveScreenshot("after_menu_existing.png")

    let currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleFixtureTestCase",
      5,
    );
    expect(currentTestHandle).not.toBe(undefined)

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleTestCase",
      5,
    );
    
    expect(currentTestHandle).not.toBe(undefined)

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.fakeTest",
      5,
    );
    
    expect(currentTestHandle).not.toBe(undefined)

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.compileErrorTest",
      5,
    );
    expect(currentTestHandle).not.toBe(undefined)

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.realTest",
      5,
    );
    
    expect(currentTestHandle).not.toBe(undefined)

    const editorView = workbench.getEditorView()
    const openTabs = await editorView.getOpenTabs()
    let titles: string[] = []
    for (const tab of openTabs) {
      const tabTitle = await tab.getTitle()
      expect(tabTitle).not.toBe("ACOMPILE.LIS")
      titles.push(tabTitle)

    }
    const expectedOpenTabTitles: string[] = ["manager-Tests.cpp"]
    for (const expectedTitle of expectedOpenTabTitles) {
      expect(expectedOpenTabTitles.includes(expectedTitle)).toBe(true)
    }

    const runButton = await currentTestHandle.getActionButton("Run Test")
    await runButton.elem.click()
    
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
   
    await webview.close()
    await editorView.closeAllEditors()
  });

  it("should verify coverage percentage shown on the Status Bar", async () => {
    await updateTestID();
    await workbench.getBottomBar().toggle(false)
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection = await expandWorkspaceFolderSectionInExplorer(
      "vcastTutorial",
    );

    let managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    await managerCpp.select()
    statusBar = workbench.getStatusBar();
    await browser.waitUntil(
      async () => ((await statusBar.getItems()).includes("Coverage: 20/41 (49%)")),
      { timeout: TIMEOUT },
    );
  
  });

  it("should run compileErrorTest and check report", async () => {
    await updateTestID();
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

    let currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.compileErrorTest",
      5,
    );
    expect(currentTestHandle).not.toBe(undefined)
      
    let ctxMenu = await currentTestHandle.openContextMenu()

    await ctxMenu.select("VectorCAST");
    let menuElem = await $("aria/Edit Coded Test");
    await menuElem.click();

    const editorView = workbench.getEditorView()
    let tab = await editorView.openEditor("manager-Tests.cpp") as TextEditor
    expect(await tab.getSelectedText()).toBe("VTEST(managerTests, compileErrorTest) {")
    
    let line = 54
    await tab.moveCursor(line, 1);
    await browser.keys(Key.Escape)
    for (let index = 0; index < 6; index++) {
      await browser.keys(Key.Enter)
    }
    await tab.setTextAtLine(line + 1, "VTEST(managerTests, myTest) {")
    await tab.setTextAtLine(line + 2, "")
    await tab.setTextAtLine(line + 3, "      VASSERT_EQ(10, 20);")
    await tab.setTextAtLine(line + 4, "      VASSERT_EQ(10, 10);")
    await tab.setTextAtLine(line + 5, "}")
  
    await tab.save()

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.myTest",
      6,
    );
    expect(currentTestHandle).not.toBe(undefined)
    
    const bottomBar = workbench.getBottomBar()
    await bottomBar.toggle(true)
    const outputView =await bottomBar.openOutputView()
    await outputView.clearText()
    await (await tab.elem).click()
    line = await tab.getLineOfText("VTEST(managerTests, myTest) {")
    await tab.moveCursor(line, 1);
    let lineNumberElement = await $(`.line-numbers=${line}`);
    let runArrowElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");

    await runArrowElement.click({button:1})
    
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT },
    );
    

    await browser.waitUntil(
      async () => ((await outputView.getText()).toString().includes("[  FAIL  ] manager.coded_tests_driver - managerTests.myTest")),
      { timeout: TIMEOUT },
    );
    
    let outputTextFlat = (await outputView.getText()).toString()
    expect(outputTextFlat.includes("[        ]   Testcase User Code Mismatch:"))
    expect(outputTextFlat.includes("[        ]   Incorrect Value: VASSERT_EQ(10, 20) = [20]"))
    expect(outputTextFlat.includes("TEST RESULT: fail"))

    let webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    let webview = webviews[0];

    await webview.open();

    await expect($("h4*=Execution Results (FAIL)")).toHaveText(
      "Execution Results (FAIL)",
    );
   
    await webview.close()
    await editorView.closeAllEditors()
      
    ctxMenu = await currentTestHandle.openContextMenu()
    await ctxMenu.select("VectorCAST");
    menuElem = await $("aria/Edit Coded Test");
    await menuElem.click();

    tab = await editorView.openEditor("manager-Tests.cpp") as TextEditor
    const selectedText = await tab.getSelectedText()
    console.log(selectedText)
    expect(selectedText.includes("VTEST(managerTests, myTest) {"))
    expect(selectedText.includes("Expected Results matched 0%"))
    await tab.setTextAtLine(57,"      VASSERT_EQ(10, 10);")
    await tab.save()
    
    line = await tab.getLineOfText("VTEST(managerTests, myTest) {")
    await tab.moveCursor(line, 1);
    lineNumberElement = await $(`.line-numbers=${line}`);
    runArrowElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");

    await runArrowElement.click({button:1})

    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT },
    );
    
    await browser.waitUntil(
      async () => ((await outputView.getText()).toString().includes("Status: passed")),
      { timeout: TIMEOUT },
    );
    
    outputTextFlat = (await outputView.getText()).toString()
    expect(outputTextFlat.includes("Status: passed"))
    expect(outputTextFlat.includes("Values: 2/2 (100.00)"))

    webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    webview = webviews[0];

    await webview.open();

    await expect($("h4*=Execution Results (PASS)")).toHaveText(
      "Execution Results (PASS)",
    );
   
    await browser.takeScreenshot()
    await browser.saveScreenshot("assertion.png")
    await webview.close()
    await editorView.closeAllEditors()
  });
});
