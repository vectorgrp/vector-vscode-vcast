// Test/specs/vcast.test.ts
import process from "node:process";
import { type BottomBarPanel, type Workbench } from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
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
    const title = await workbench.getTitleBar().getTitle();
    expect(title).toBe(
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

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
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

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();

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
    const cppFolder = await workspaceFolderSection.findItem("cpp");
    await cppFolder.select();

    // Get file and "Create VectorCAST Environment"
    const managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    await managerCpp.select();

    await managerCpp.openContextMenu();

    const createButton = await $("aria/Create VectorCAST Environment");
    await createButton.click();

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

    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();

    // Open Settings and put in valid path
    const settingsEditor = await workbench.openSettings();
    const unitTestLocationSetting = await settingsEditor.findSetting(
      "Vectorcast Installation Location",
      "Vectorcast Test Explorer"
    );
    await unitTestLocationSetting.setValue(process.env.VC_DIR);

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();

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

    const setConfigButton = await $(
      "aria/Set as VectorCAST Configuration File"
    );
    await setConfigButton.click();

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();
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

    const createButton = await $("aria/Create VectorCAST Environment");
    await createButton.click();

    // Making sure notifications are shown
    const notifications = await $("aria/Notifications");
    await notifications.click();

    console.log("Notifications are shown");
    // This will timeout if VectorCAST notification does not appear, resulting in a failed test
    const vcastNotificationSourceElement = await $(
      "aria/VectorCAST Test Explorer (Extension)"
    );

    const vcastNotification = await vcastNotificationSourceElement.$("..");
    const yesButton = await vcastNotification.$("aria/Yes");
    await yesButton.click();

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
    const vscodeFolderItem = await workspaceFolderSection.findItem(".vscode");
    await vscodeFolderItem.select();

    // Select the settings.json and open context menu and delete it
    const settingsFile = await workspaceFolderSection.findItem("settings.json");
    await settingsFile.select();
    const contextMenu = await settingsFile.openContextMenu();
    const deleteMenuItem = await contextMenu.getItem("Delete");
    await deleteMenuItem.select();
  });
});
