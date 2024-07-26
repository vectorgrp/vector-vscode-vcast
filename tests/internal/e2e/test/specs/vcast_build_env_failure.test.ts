// Test/specs/vcast.test.ts
import { type BottomBarPanel, type Workbench } from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
} from "../test_utils/vcast_utils";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
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

    // Await last expected sentence
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            "Please refer to the installation and configuration instructions for details on resolving these issues"
          ),
      { timeout: TIMEOUT }
    );
  });

  it("should throw an error on invalid PATH env", async () => {
    await updateTestID();
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    // Put in invalid path in settings
    const settingsEditor = await workbench.openSettings();
    const unitTestLocationSetting = await settingsEditor.findSetting(
      "Vectorcast Installation Location",
      "Vectorcast Test Explorer"
    );
    await unitTestLocationSetting.setValue("some/invalid/path");

    await (await workbench.openNotificationsCenter()).clearAllNotifications();

    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();

    // Await last expected sentence
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            "Please refer to the installation and configuration instructions for details on resolving these issues"
          ),
      { timeout: TIMEOUT }
    );
  });

  it("should create VectorCAST environment and fail", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    // Expand vcastTutorial and cpp folder
    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");
    const cppFolder = workspaceFolderSection.findItem("cpp");
    await (await cppFolder).select();

    // Get file and "Create VectorCAST Environment"
    const managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    await managerCpp.select();
    console.log("Selected File: " + managerCpp);

    await managerCpp.openContextMenu();
    await (await $("aria/Create VectorCAST Environment")).click();

    // Await last expected sentence
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            "Please refer to the installation and configuration instructions for details on resolving these issues"
          ),
      { timeout: TIMEOUT }
    );
  });

  it("should activate vcastAdapter with correct path", async () => {
    await updateTestID();

    const activityBar = workbench.getActivityBar();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();

    // Open Settings and put in valid path
    const settingsEditor = await workbench.openSettings();
    const unitTestLocationSetting = await settingsEditor.findSetting(
      "Vectorcast Installation Location",
      "Vectorcast Test Explorer"
    );
    await unitTestLocationSetting.setValue(process.env.VC_DIR);

    await (await workbench.openNotificationsCenter()).clearAllNotifications();

    // Await last expected sentence
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            "Starting the language server client for test script editing"
          ),
      { timeout: TIMEOUT }
    );
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
    await (await workbench.openNotificationsCenter()).clearAllNotifications();
  });

  it("should create VectorCAST environment and succeed", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    const explorerSideBarView = await explorerView?.openView();

    // Don't open folder again since its already expanded
    const workspaceName = "vcastTutorial";
    const workspaceFolderSection = await explorerSideBarView
      .getContent()
      .getSection(workspaceName.toUpperCase());

    const managerCpp = await workspaceFolderSection.findItem("manager.cpp");

    await managerCpp.openContextMenu();
    await (await $("aria/Create VectorCAST Environment")).click();

    // Making sure notifications are shown
    await (await $("aria/Notifications")).click();

    console.log("Notifications are shown");
    // This will timeout if VectorCAST notification does not appear, resulting in a failed test
    const vcastNotificationSourceElement = await $(
      "aria/VectorCAST Test Explorer (Extension)"
    );
    const vcastNotification = await vcastNotificationSourceElement.$("..");

    await (await vcastNotification.$("aria/Yes")).click();

    console.log("Notifications clicked yes");
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
  });

  it("should delete settings.json in .vscode folder", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    const explorerSideBarView = await explorerView?.openView();

    const workspaceName = "vcastTutorial";
    const workspaceFolderSection = await explorerSideBarView
      .getContent()
      .getSection(workspaceName.toUpperCase());

    // Open.vscode folder
    let vscodeFolderItem = await workspaceFolderSection.findItem(".vscode");
    await vscodeFolderItem.select();

    // Select the settings.json and open context menu and delete it
    const settingsFile = await workspaceFolderSection.findItem("settings.json");
    await settingsFile.select();
    const contextMenu = await settingsFile.openContextMenu();
    const deleteMenuItem = await contextMenu.getItem("Delete");
    await deleteMenuItem.select();
  });
});
