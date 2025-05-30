// Test/specs/vcast_coded_tests.test.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  BottomBarPanel,
  type StatusBar,
  type TextEditor,
  type Workbench,
  type TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  releaseCtrl,
  executeCtrlClickOn,
  expandWorkspaceFolderSectionInExplorer,
  clickOnButtonInTestingHeader,
  getViewContent,
  findSubprogram,
  getTestHandle,
  findSubprogramMethod,
  updateTestID,
  checkForLogsInTestResults,
  checkElementExistsInHTML,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";

const promisifiedExec = promisify(exec);
describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let statusBar: StatusBar;
  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    process.env.E2E_TEST_ID = "0";
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

  it("should set default config file", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");

    const configFile = await workspaceFolderSection.findItem("CCAST_.CFG");
    await configFile.openContextMenu();
    await (await $("aria/Set as VectorCAST Configuration File")).click();
  });

  it("should enable coded testing", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const settingsEditor = await workbench.openSettings();
    console.log("Looking for coded tests settings");
    await settingsEditor.findSetting(
      "vectorcastTestExplorer.enableCodedTesting"
    );
    // Only one setting in search results, so the current way of clicking is correct
    console.log("Enabling coded tests");
    await (await settingsEditor.checkboxSetting$).click();
    await workbench.getEditorView().closeAllEditors();
  });

  it("should create VectorCAST environment", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");
    const cppFolder = workspaceFolderSection.findItem("cpp");
    await (await cppFolder).select();

    const managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    const databaseCpp = await workspaceFolderSection.findItem("database.cpp");
    await executeCtrlClickOn(databaseCpp);
    await executeCtrlClickOn(managerCpp);
    await releaseCtrl();

    await databaseCpp.openContextMenu();
    await (await $("aria/Create VectorCAST Environment")).click();

    // Making sure notifications are shown
    await (await $("aria/Notifications")).click();

    // This will timeout if VectorCAST notification does not appear, resulting in a failed test
    await browser.pause(4000);
    const vcastNotificationSourceElement = await $(
      "aria/VectorCAST Test Explorer (Extension)"
    );
    const vcastNotification = await vcastNotificationSourceElement.$("..");
    await (await vcastNotification.$("aria/Yes")).click();

    console.log(
      "Waiting for clicast and waiting for environment to get processed"
    );
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("Environment built Successfully"),
      { timeout: TIMEOUT }
    );

    console.log("Finished creating vcast environment");
    await browser.takeScreenshot();
    await browser.saveScreenshot(
      "info_finished_creating_vcast_environment.png"
    );
    // Clearing all notifications
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
    const editorView = workbench.getEditorView();
    const activeTab = await editorView.getActiveTab();
    expect(await activeTab.getTitle()).toBe("Settings");

    await $(
      ".setting-item-description*=Decorate files that have coverage in the File Explorer pane"
    );
    await editorView.closeEditor("Settings");
  });

  it("should generate and run template test", async () => {
    await updateTestID();
    const outputView = await bottomBar.openOutputView();
    await bottomBar.openOutputView();
    await outputView.clearText();

    console.log("Opening Testing View");
    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded()))
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand();
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          if (!(await subprogram.isExpanded())) await subprogram.expand();
          break;
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Looking for coded tests");
    const subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Coded Tests"
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Coded Tests' not found";
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }

    let contextMenu = await subprogramMethod.openContextMenu();
    console.log("Generating template test");
    await contextMenu.select("VectorCAST");
    let menuElement = await $("aria/Generate New Coded Test File");
    await menuElement.click();

    await (await $("aria/Save Code Test File")).click();
    for (const character of "TestFiles/manager-template.cpp") {
      await browser.keys(character);
    }

    await browser.keys(Key.Enter);
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Adding coded test file"),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data for:"),
      { timeout: TIMEOUT }
    );

    await bottomBar.openOutputView();
    console.log("Checking that tests got generated");
    let testHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleFixtureTestCase",
      2
    );
    expect(testHandle).not.toBe(undefined);

    testHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleTestCase",
      2
    );
    expect(testHandle).not.toBe(undefined);

    contextMenu = await testHandle.openContextMenu();
    await contextMenu.select("VectorCAST");
    menuElement = await $("aria/Edit Coded Test");
    await menuElement.click();

    const editorView = workbench.getEditorView();
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "manager-template.cpp"
    );
    console.log("Checking that there are no problem markers");
    const problemsView = await bottomBar.openProblemsView();
    const problemMarkers = await problemsView.getAllMarkers();
    expect(problemMarkers.length).toBe(0);

    console.log("Running template test managerTests.ExampleTestCase");
    const runButton = await testHandle.getActionButton("Run Test");
    await runButton.elem.click();

    console.log("Checking the test report");
    // It is expected that the VectorCast Report WebView is the only existing WebView at the moment
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

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

    await webview.close();
    await editorView.closeAllEditors();
  });

  it("should check the debug prep with coverage turned ON", async () => {
    await updateTestID();
    const bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    console.log("Looking for managerTests.ExampleTestCase");
    let subprogram: TreeItem;
    let testHandle: TreeItem;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        if (!(await subprogram.isExpanded())) await subprogram.expand();
        console.log("Getting test handle");
        testHandle = await getTestHandle(
          subprogram,
          "Coded Tests",
          "managerTests.ExampleTestCase",
          2
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

    const debugButton = await testHandle.getActionButton("Debug Test");
    console.log("Showing generated debug configuration");
    await debugButton.elem.click();
    console.log(await outputView.getText());
    const editorView = workbench.getEditorView();
    console.log("Validating that debug launch configuration got generated");

    await browser.waitUntil(
      async () => (await editorView.getOpenTabs()).length > 0,
      { timeout: TIMEOUT }
    );

    const debugConfigTab = (await editorView.openEditor(
      "launch.json"
    )) as TextEditor;

    await browser.waitUntil(
      async () => (await debugConfigTab.getText()) !== "",
      { timeout: TIMEOUT }
    );

    const allTextFromDebugConfig = await debugConfigTab.getText();
    expect(allTextFromDebugConfig.includes("configurations")).toBe(true);
    expect(allTextFromDebugConfig.includes("VectorCAST Harness Debug"));

    console.log("Showing instrumented file");
    await debugButton.elem.click();
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "manager_exp_inst_driver.c",
      { timeout: TIMEOUT }
    );
    const activeTab = await editorView.getActiveTab();
    const activeTabTitle = await activeTab.getTitle();
    console.log(activeTabTitle);
    expect(activeTabTitle).toBe("manager_exp_inst_driver.c");

    const activeTabTextEditor = (await editorView.openEditor(
      "manager_exp_inst_driver.c"
    )) as TextEditor;
    const selectedText = await activeTabTextEditor.getSelectedText();
    console.log(selectedText);
    expect(selectedText).toHaveTextContaining(
      "class Test_managerTests_realTest"
    );

    await editorView.closeAllEditors();

    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");

    const managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    await managerCpp.select();
  });
  it("should check the debug prep with coverage turned OFF", async () => {
    await updateTestID();
    const bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    console.log("Turning off coverage");
    {
      const turnOffCoverageCmd =
        "cd test/vcastTutorial/cpp/unitTests && clicast -e DATABASE-MANAGER tools coverage disable";
      const { stdout, stderr } = await promisifiedExec(turnOffCoverageCmd);

      if (stderr) {
        console.log(stderr);
        throw `Error when running ${turnOffCoverageCmd}`;
      }

      console.log(stdout);
    }

    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    console.log("Looking for managerTests.ExampleTestCase");
    let subprogram: TreeItem;
    let testHandle: TreeItem;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        if (!(await subprogram.isExpanded())) await subprogram.expand();
        console.log("Getting test handle");
        testHandle = await getTestHandle(
          subprogram,
          "Coded Tests",
          "managerTests.ExampleTestCase",
          2
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

    let debugButton = await testHandle.getActionButton("Debug Test");
    console.log("Showing generated debug configuration");
    await debugButton.elem.click();

    const editorView = workbench.getEditorView();
    console.log("Validating that debug launch configuration got generated");
    console.log(await outputView.getText());

    console.log("Showing non-instrumented file");
    debugButton = await testHandle.getActionButton("Debug Test");
    await debugButton.elem.click();
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "manager_expanded_driver.c",
      { timeout: TIMEOUT }
    );
    const activeTab = await editorView.getActiveTab();
    const activeTabTitle = await activeTab.getTitle();
    console.log(activeTabTitle);
    expect(activeTabTitle).toBe("manager_expanded_driver.c");

    const activeTabTextEditor = (await editorView.openEditor(
      "manager_expanded_driver.c"
    )) as TextEditor;
    const selectedText = await activeTabTextEditor.getSelectedText();
    console.log(selectedText);
    expect(selectedText).toHaveTextContaining(
      "class Test_managerTests_realTest"
    );
    await editorView.closeAllEditors();

    console.log("Turning coverage back on");
    {
      const turnOffCoverageCmd =
        "cd test/vcastTutorial/cpp/unitTests && clicast -e DATABASE-MANAGER tools coverage enable";
      const { stdout, stderr } = await promisifiedExec(turnOffCoverageCmd);

      if (stderr) {
        console.log(stderr);
        throw `Error when running ${turnOffCoverageCmd}`;
      }

      console.log(stdout);
    }

    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");
    await bottomBar.toggle(false);
    const managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    await managerCpp.select();
  });

  it("should delete Coded Tests", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded()))
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand();
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          if (!(await subprogram.isExpanded())) await subprogram.expand();
          break;
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Looking for coded tests");
    const subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Coded Tests"
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Coded Tests' not found";
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }

    const bottomBar = workbench.getBottomBar();
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    const contextMenu = await subprogramMethod.openContextMenu();
    console.log("Deleting coded tests");
    await contextMenu.select("VectorCAST");
    const menuElement = await $("aria/Remove Coded Tests");
    await menuElement.click();

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Deleting tests for node"),
      { timeout: TIMEOUT }
    );
    const outputText = (await outputView.getText()).toString();
    console.log(outputText);
    expect(outputText.includes("Deleting tests for node:")).toBe(true);

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data"),
      { timeout: TIMEOUT }
    );
    await outputView.clearText();
  });

  it("should add a coded test file with a compile error", async () => {
    await updateTestID();
    const outputView = await bottomBar.openOutputView();
    await bottomBar.openOutputView();
    await outputView.clearText();

    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded()))
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand();
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          if (!(await subprogram.isExpanded())) await subprogram.expand();
          break;
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Looking for coded tests");
    const subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Coded Tests"
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Coded Tests' not found";
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }

    console.log("Adding existing coded tests file");
    const contextMenu = await subprogramMethod.openContextMenu();

    await contextMenu.select("VectorCAST");
    const menuElement = await $("aria/Add Existing Coded Test File");
    await menuElement.click();

    await (await $("aria/Select Coded Test File")).click();
    for (const character of "TestFiles/manager-Tests.cpp") {
      await browser.keys(character);
    }

    await browser.keys(Key.Enter);

    await bottomBar.openOutputView();
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Adding coded test file"),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data for:"),
      { timeout: TIMEOUT }
    );
    console.log("Checking that all tests appear");
    let currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleFixtureTestCase",
      5
    );
    expect(currentTestHandle).not.toBe(undefined);

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleTestCase",
      5
    );

    expect(currentTestHandle).not.toBe(undefined);

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.realTest",
      5
    );

    expect(currentTestHandle).not.toBe(undefined);

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.fakeTest",
      5
    );

    expect(currentTestHandle).not.toBe(undefined);

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.compileErrorTest",
      5
    );
    expect(currentTestHandle).not.toBe(undefined);
    console.log(
      "Checking that manager-Tests.cpp and ACOMPILE.LIS tabs are opened"
    );
    const editorView = workbench.getEditorView();
    const openTabs = await editorView.getOpenTabs();
    const titles: string[] = [];
    for (const tab of openTabs) {
      titles.push(await tab.getTitle());
    }

    const expectedOpenTabTitles: string[] = [
      "manager-Tests.cpp",
      "ACOMPILE.LIS",
    ];
    for (const expectedTitle of expectedOpenTabTitles) {
      expect(expectedOpenTabTitles.includes(expectedTitle)).toBe(true);
    }

    const sourceFileTab = (await editorView.openEditor(
      "manager-Tests.cpp"
    )) as TextEditor;
    const line = await sourceFileTab.getLineOfText("compile-error-here");
    await sourceFileTab.setTextAtLine(line, "");
    await sourceFileTab.save();
  });

  it("should delete Coded Tests", async () => {
    await updateTestID();
    const bottomBar = workbench.getBottomBar();
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded()))
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand();
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          if (!(await subprogram.isExpanded())) await subprogram.expand();
          break;
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Looking for coded tests");
    const subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Coded Tests"
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Coded Tests' not found";
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }

    const contextMenu = await subprogramMethod.openContextMenu();
    console.log("Deleting coded tests");
    await contextMenu.select("VectorCAST");
    const menuElement = await $("aria/Remove Coded Tests");
    await menuElement.click();

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Deleting tests for node"),
      { timeout: TIMEOUT }
    );
    const outputText = (await outputView.getText()).toString();
    console.log(outputText);
    expect(outputText.includes("Deleting tests for node:")).toBe(true);

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data"),
      { timeout: TIMEOUT }
    );
    await outputView.clearText();
  });

  it("should add a coded test file without the compile error", async () => {
    await updateTestID();
    const outputView = await bottomBar.openOutputView();

    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded()))
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand();
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          if (!(await subprogram.isExpanded())) await subprogram.expand();
          break;
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Looking for Coded Tests");
    const subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Coded Tests"
    );
    if (!subprogramMethod) {
      throw "Subprogram method 'Coded Tests' not found";
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }

    await outputView.clearText();
    const contextMenu = await subprogramMethod.openContextMenu();
    console.log("Adding existing coded tests file");
    await contextMenu.select("VectorCAST");
    const menuElement = await $("aria/Add Existing Coded Test File");
    await menuElement.click();

    const textbox = await $("aria/Select Coded Test File");
    await textbox.click();
    await browser.keys(Key.End);
    for (const character of "manager-Tests.cpp") {
      await browser.keys(character);
    }

    await browser.keys(Key.Enter);

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Adding coded test file"),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data for:"),
      { timeout: TIMEOUT }
    );

    await bottomBar.openOutputView();
    console.log("Checking that all tests appear");
    let currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleFixtureTestCase",
      5
    );
    expect(currentTestHandle).not.toBe(undefined);

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.ExampleTestCase",
      5
    );

    expect(currentTestHandle).not.toBe(undefined);

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.fakeTest",
      5
    );

    expect(currentTestHandle).not.toBe(undefined);

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.compileErrorTest",
      5
    );
    expect(currentTestHandle).not.toBe(undefined);

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.realTest",
      5
    );

    expect(currentTestHandle).not.toBe(undefined);
    console.log(
      "Checking that only manager-Tests.cpp tab is opened, no compile errors"
    );
    const editorView = workbench.getEditorView();
    const openTabs = await editorView.getOpenTabs();
    const titles: string[] = [];
    for (const tab of openTabs) {
      const tabTitle = await tab.getTitle();
      expect(tabTitle).not.toBe("ACOMPILE.LIS");
      titles.push(tabTitle);
    }

    const expectedOpenTabTitles: string[] = ["manager-Tests.cpp"];
    for (const expectedTitle of expectedOpenTabTitles) {
      expect(expectedOpenTabTitles.includes(expectedTitle)).toBe(true);
    }

    console.log("Running managerTests.realTest");
    const runButton = await currentTestHandle.getActionButton("Run Test");
    await runButton.elem.click();

    console.log("Checking test report");
    // It is expected that the VectorCast Report WebView is the only existing WebView at the moment
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();

    expect(await checkElementExistsInHTML("Execution Results (FAIL)")).toBe(
      true
    );

    await webview.close();
    await editorView.closeAllEditors();
  });

  it("should verify coverage percentage shown on the Status Bar", async () => {
    await updateTestID();
    await workbench.getBottomBar().toggle(false);
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");

    const managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    await managerCpp.select();
    statusBar = workbench.getStatusBar();
    console.log("Getting coverage percentage from Status Bar");
    await browser.waitUntil(
      async () =>
        (await statusBar.getItems()).includes("Coverage: 20/41 (49%)"),
      { timeout: TIMEOUT }
    );
  });

  it("should run compileErrorTest and check report", async () => {
    await updateTestID();
    const bottomBar = workbench.getBottomBar();
    const outputView = await bottomBar.openOutputView();
    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded()))
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand();
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          if (!(await subprogram.isExpanded())) await subprogram.expand();
          break;
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Looking for compileErrorTest");
    let currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.compileErrorTest",
      5
    );
    expect(currentTestHandle).not.toBe(undefined);

    let contextMenu = await currentTestHandle.openContextMenu();

    await contextMenu.select("VectorCAST");
    let menuElement = await $("aria/Edit Coded Test");
    await menuElement.click();

    const editorView = workbench.getEditorView();
    let tab = (await editorView.openEditor("manager-Tests.cpp")) as TextEditor;
    console.log(
      "Checking that VTEST(managerTests, compileErrorTest) { is selected"
    );
    expect(await tab.getSelectedText()).toBe(
      "VTEST(managerTests, compileErrorTest) {"
    );

    console.log("Adding managerTest.myTest to the test script");
    await outputView.clearText();
    let line = 54;
    await tab.moveCursor(line, 1);
    await browser.keys(Key.Escape);
    for (let index = 0; index < 6; index++) {
      await browser.keys(Key.Enter);
    }

    await tab.setTextAtLine(line + 1, "VTEST(managerTests, myTest) {");
    await tab.setTextAtLine(line + 2, "");
    await tab.setTextAtLine(line + 3, "      VASSERT_EQ(10, 20);");
    await tab.setTextAtLine(line + 4, "      VASSERT_EQ(10, 10);");
    await tab.setTextAtLine(line + 5, "}");
    await tab.save();

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data for:"),
      { timeout: TIMEOUT }
    );

    console.log(
      "Verifying that managerTests.myTest appears in the test explorer"
    );
    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.myTest",
      6
    );
    expect(currentTestHandle).not.toBe(undefined);
    await outputView.clearText();
    await (await tab.elem).click();

    console.log(
      "Running managerTests.myTest using the button inside the test script"
    );
    line = await tab.getLineOfText("VTEST(managerTests, myTest) {");
    await tab.moveCursor(line, 1);
    let lineNumberElement = await $(`.line-numbers=${line}`);
    let runArrowElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");

    await runArrowElement.click({ button: 1 });

    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );

    console.log("Verifying test output");

    await bottomBar.maximize();
    let logArray = [
      "[  FAIL  ] manager.coded_tests_driver - managerTests.myTest",
    ];
    await checkForLogsInTestResults(logArray);
    await bottomBar.restore();

    console.log("Checking test report");
    let webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    let webview = webviews[0];

    await webview.open();

    expect(await checkElementExistsInHTML("Execution Results (FAIL)")).toBe(
      true
    );

    await webview.close();
    await editorView.closeAllEditors();

    contextMenu = await currentTestHandle.openContextMenu();
    await contextMenu.select("VectorCAST");
    menuElement = await $("aria/Edit Coded Test");
    await menuElement.click();

    tab = (await editorView.openEditor("manager-Tests.cpp")) as TextEditor;
    const selectedText = await tab.getSelectedText();
    console.log(
      "Verifying that Expected Results matched 0% appears next to the test"
    );
    expect(selectedText.includes("VTEST(managerTests, myTest) {"));
    expect(selectedText.includes("Expected Results matched 0%"));
    console.log("Adapting expected values");
    await tab.setTextAtLine(57, "      VASSERT_EQ(10, 10);");
    await tab.save();

    line = await tab.getLineOfText("VTEST(managerTests, myTest) {");
    await tab.moveCursor(line, 1);
    lineNumberElement = await $(`.line-numbers=${line}`);
    runArrowElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");
    console.log("Running adapted test");
    await runArrowElement.click({ button: 1 });

    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    console.log("Verifying Test Results");

    await bottomBar.maximize();
    logArray = ["Status: passed", "Values: 2/2 (100.00)"];
    await checkForLogsInTestResults(logArray);
    await bottomBar.restore();

    console.log("Checking test reports");
    webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    webview = webviews[0];
    await webview.open();

    expect(await checkElementExistsInHTML("Execution Results (PASS)")).toBe(
      true
    );

    await webview.close();
    await editorView.closeAllEditors();
  });

  it("test behavior for when a Compile Error is introduced in Coded Test", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded()))
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand();
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          if (!(await subprogram.isExpanded())) await subprogram.expand();
          break;
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Looking for managerTests.compileErrorTest");
    let currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.compileErrorTest",
      6
    );
    expect(currentTestHandle).not.toBe(undefined);

    let contextMenu = await currentTestHandle.openContextMenu();

    await contextMenu.select("VectorCAST");
    let menuElement = await $("aria/Edit Coded Test");
    await menuElement.click();

    console.log("Introducing compile error in managerTests.compileErrorTest");
    const editorView = workbench.getEditorView();
    let tab = (await editorView.openEditor("manager-Tests.cpp")) as TextEditor;
    expect(await tab.getSelectedText()).toBe(
      "VTEST(managerTests, compileErrorTest) {"
    );
    await browser.keys(Key.Escape);
    const line = await tab.getLineOfText(
      "VTEST(managerTests, compileErrorTest) {"
    );
    await tab.moveCursor(
      line,
      "VTEST(managerTests, compileErrorTest) {".length + 1
    );
    await browser.keys(Key.Enter);
    await tab.setTextAtLine(line + 1, "nonsense text");
    await tab.save();

    await tab.moveCursor(line, 1);
    let lineNumberElement = await $(`.line-numbers=${line}`);
    let runArrowElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");
    console.log("Running managerTests.compileErrorTest");
    await runArrowElement.click({ button: 1 });

    // Checking opened tabs
    console.log(
      "Checking both manager-Tests.cpp and ACOMPILE.LIS tabs are opened"
    );
    const openTabs = await editorView.getOpenTabs();
    const titles: string[] = [];
    for (const tab of openTabs) {
      titles.push(await tab.getTitle());
    }

    const expectedOpenTabTitles: string[] = [
      "manager-Tests.cpp",
      "ACOMPILE.LIS",
    ];
    for (const expectedTitle of expectedOpenTabTitles) {
      expect(expectedOpenTabTitles.includes(expectedTitle)).toBe(true);
    }

    console.log("Checking that compile error text squiggle appears");
    const expectedErrorText =
      "Coded Test compile error - see details in file: ACOMPILE.LIS";
    const textWithError = await $(`aria/${expectedErrorText}`).getText();
    console.log(`text with error: ${textWithError}`);
    expect(
      textWithError.includes(
        "Coded Test compile error - see details in file: ACOMPILE.LIS"
      )
    ).toBe(true);

    //Need to close tabs, otherwise can't interact with tab content properly
    await browser.keys(Key.Escape);
    await editorView.closeAllEditors();

    currentTestHandle = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.compileErrorTest",
      6
    );
    contextMenu = await currentTestHandle.openContextMenu();
    await contextMenu.select("VectorCAST");
    menuElement = await $("aria/Edit Coded Test");
    await menuElement.click();

    console.log("Correcting compile error");
    tab = (await editorView.openEditor("manager-Tests.cpp")) as TextEditor;
    await tab.elem.click();
    await browser.keys(Key.Escape);
    const errorLine = await tab.getLineOfText("nonsense text");
    const messageLine = errorLine - 1;
    await tab.moveCursor(messageLine, 1);

    console.log("Open Editor");
    await tab.setTextAtLine(errorLine, "");
    await tab.save();
    await editorView.closeAllEditors();

    console.log("Getting testhandle again");
    let currentTestHandle2 = await getTestHandle(
      subprogram,
      "Coded Tests",
      "managerTests.compileErrorTest",
      6
    );

    console.log("Executing Edid Coded Test");
    contextMenu = await currentTestHandle2.openContextMenu();
    await contextMenu.select("VectorCAST");
    menuElement = await $("aria/Edit Coded Test");
    await menuElement.click();
    tab = (await editorView.openEditor("manager-Tests.cpp")) as TextEditor;

    console.log("Opened Editor");
    await (await tab.elem).click();
    // Closing the squiggle
    await browser.keys(Key.Escape);
    await (await tab.elem).click();

    console.log("Moving cursor to the line with the error");
    await tab.moveCursor(messageLine, 1);
    lineNumberElement = await $(`.line-numbers=${messageLine}`);
    runArrowElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");

    console.log("Running corrected test");
    await runArrowElement.click({ button: 1 });

    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );

    console.log("Verifying Test Results");
    await bottomBar.maximize();
    const logArray = [
      "[        ]   Testcase User Code Mismatch:",
      "[        ]   Incorrect Value: VASSERT_EQ(10, 20) = [20]",
      "TEST RESULT: fail",
    ];
    await checkForLogsInTestResults(logArray);
    await bottomBar.restore();

    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];
    await webview.open();
    console.log("Checking test report");

    expect(await checkElementExistsInHTML("Execution Results (FAIL)")).toBe(
      true
    );

    await webview.close();
    await editorView.closeAllEditors();
  });
});
