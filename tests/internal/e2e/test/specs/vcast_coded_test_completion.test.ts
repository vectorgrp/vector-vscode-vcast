// Test/specs/vcast_coded_tests.test.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  type BottomBarPanel,
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
  cleanup,
} from "../test_utils/vcast_utils";

const promisifiedExec = promisify(exec);
describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let statusBar: StatusBar;
  const TIMEOUT = 120_000;
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

    // Insert "// vmock" on line 16
    const tab = (await editorView.openEditor(
      "manager-template.cpp"
    )) as TextEditor;
    await browser.keys([Key.Ctrl, Key.Space]);
    const contentAssist = await tab.toggleContentAssist(true);
    await tab.setTextAtLine(14, "// vmock");

    // Ensure cursor is positioned after "// vmock"
    let currentLine = await tab.getLineOfText("// vmock");
    await tab.typeTextAt(currentLine, "// vmock".length + 1, " ");
    await tab.save();
    await browser.waitUntil(
      async () => (await contentAssist.getItems()).length > 0
    );

    // Validate content assist items
    console.log("Validating content assist for '// vmock'");
    expect(await contentAssist.hasItem("unit")).toBe(true);
    expect(await contentAssist.hasItem("Prototype-Stubs")).toBe(true);

    console.log("Content assist validation passed.");
  });

  it("should clean up", async () => {
    await updateTestID();
    await cleanup();
  });
});