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

    await $("aria/Save Code Test File")
    for (const character of "TestFiles/manager-template.cpp") {
      await browser.keys(character);
    }
    
    await browser.keys(Key.Enter);
    // const okButton = await $("aria/OK");
    // await okButton.click();
    // subprogramMethod = await findSubprogramMethod(
    //   subprogram,
    //   "Coded Tests",
    // );
    // if (!subprogramMethod.isExpanded()) {
    //   await subprogramMethod.select();
    // }
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
    await browser.pause(10000)
    
  });

  

});
