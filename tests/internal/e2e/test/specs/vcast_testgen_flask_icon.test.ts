// Test/specs/vcast.test.ts
import { type BottomBarPanel, type Workbench } from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  releaseCtrl,
  executeCtrlClickOn,
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
  testGenMethod,
  generateFlaskIconTestsFor,
  validateGeneratedTest,
  deleteGeneratedTest,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
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

    // Need to wait because there are more than one "Processing environment data for" messages
    await browser.pause(4000);

    console.log("Finished creating vcast environment");
    await browser.takeScreenshot();
    await browser.saveScreenshot(
      "info_finished_creating_vcast_environment.png"
    );
    // Clearing all notifications
    await (await $(".codicon-notifications-clear-all")).click();
  });

  it("should correctly generate BASIS PATH tests by clicking on flask+ icon", async () => {
    const outputView = await bottomBar.openOutputView();
    await updateTestID();
    console.log(
      "Generating all BASIS PATH tests for function DataBase::GetTableRecord using Flask icon"
    );
    await generateFlaskIconTestsFor(
      10,
      testGenMethod.BasisPath,
      "database.cpp"
    );
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Script loaded successfully"),
      { timeout: TIMEOUT }
    );
    await validateGeneratedTest(
      testGenMethod.BasisPath,
      "DATABASE-MANAGER",
      "database",
      "DataBase::GetTableRecord",
      "BASIS-PATH-001",
      1
    );
  });

  it("should correctly delete BASIS PATH tests generated by clicking on flask+ icon", async () => {
    await updateTestID();
    console.log(
      "Deleting all BASIS PATH tests for function DataBase::GetTableRecord using Flask icon"
    );
    await deleteGeneratedTest(
      "database",
      "DataBase::GetTableRecord",
      "BASIS-PATH-001",
      1
    );
  });

  it("should correctly generate ATG tests by clicking on flask+ icon", async () => {
    await updateTestID();
    const outputView = await bottomBar.openOutputView();

    // Clean the output so that we can wait again for the Script loaded successfully message
    await outputView.clearText();

    if (process.env.ENABLE_ATG_FEATURE === "TRUE") {
      console.log(
        "Generating all ATG tests for function DataBase::GetTableRecord using Flask icon"
      );
      await generateFlaskIconTestsFor(10, testGenMethod.ATG, "database.cpp");
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes("Script loaded successfully"),
        { timeout: TIMEOUT }
      );
      await validateGeneratedTest(
        testGenMethod.ATG,
        "DATABASE-MANAGER",
        "database",
        "DataBase::GetTableRecord",
        "ATG-TEST-1",
        1
      );
    } else {
      console.log("Skipping ATG tests");
    }
  });

  it("should correctly delete ATG tests generated by clicking on flask+ icon", async () => {
    await updateTestID();
    if (process.env.ENABLE_ATG_FEATURE === "TRUE") {
      console.log(
        "Deleting all ATG tests for function DataBase::GetTableRecord using Flask icon"
      );
      await deleteGeneratedTest(
        "database",
        "DataBase::GetTableRecord",
        "ATG-TEST-1",
        1
      );
    }
  });
});
