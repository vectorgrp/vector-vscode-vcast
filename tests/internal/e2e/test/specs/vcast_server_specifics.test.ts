// Test/specs/vcast.test.ts
import process from "node:process";
import path from "node:path";
import { type BottomBarPanel, type Workbench } from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
  getLastLineOfOutputView,
  TIMEOUT,
} from "../test_utils/vcast_utils";

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
    const workbench = await browser.getWorkbench();
    const title = await workbench.getTitleBar().getTitle();
    expect(title).toMatch(
      /\[Extension Development Host] (● )?vcastTutorial - Visual Studio Code/
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

  it("should set PATH to release24_sp4", async () => {
    const outputView = await bottomBar.openOutputView();
    // Check if we are on CI
    let vcastRoot: string;
    if (process.env.HOME.startsWith("/github")) {
      vcastRoot = "/vcast";
    } else {
      // Assuming that locally release is on this path.
      vcastRoot = path.join(process.env.HOME, "vcast");
    }

    const newVersion = "release24_sp4";
    const release24Path = path.join(vcastRoot, newVersion);

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    // Put in release 24_sp4 path in settings
    const settingsEditor = await workbench.openSettings();
    const unitTestLocationSetting = await settingsEditor.findSetting(
      "Vectorcast Installation Location",
      "Vectorcast Test Explorer"
    );

    await unitTestLocationSetting.setValue(release24Path);

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("VectorCAST Data Server exited successfully"),
      { timeout: TIMEOUT }
    );

    let statusBar = workbench.getStatusBar();
    // When setting to a wrong path, vDataServer Status Button should be disabled
    const statusBarInfos = await statusBar.getItems();
    expect(statusBarInfos.includes("vDataServer On")).toBe(false);
    expect(statusBarInfos.includes("vDataServer Off")).toBe(false);
  });

  it("should toggle `Use Data Server` off & on", async () => {
    await updateTestID();
    const workbench = await browser.getWorkbench();
    const settingsEditor = await workbench.openSettings();

    console.log("Looking for Use Data Server settings");
    await settingsEditor.findSetting("vectorcastTestExplorer.useDataServer");

    // Get the initial last line of the output view
    let lastLineBefore = await getLastLineOfOutputView(bottomBar);

    // Toggle `Use Data Server` OFF
    console.log("Turning on `Use Data Server` in Settings");
    await (await settingsEditor.checkboxSetting$).click();

    // Wait for 2 seconds to be sure no new messages come as we expect nothing to come
    await browser.pause(2000);

    // Get the new last line after toggling
    let lastLineAfter = await getLastLineOfOutputView(bottomBar);
    expect(lastLineBefore).toEqual(lastLineAfter);

    // Toggle `Use Data Server` OFF
    console.log("Turning off `Use Data Server` in Settings");
    await (await settingsEditor.checkboxSetting$).click();

    // Wait for 2 seconds to be sure no new messages come as we expect nothing to come
    await browser.pause(2000);

    // Get the new last line after toggling
    lastLineAfter = await getLastLineOfOutputView(bottomBar);
    expect(lastLineBefore).toEqual(lastLineAfter);

    // Toggle `Use Data Server` ON
    console.log("Turning on `Use Data Server` in Settings");
    await (await settingsEditor.checkboxSetting$).click();

    // Wait for 2 seconds to be sure no new messages come as we expect nothing to come
    await browser.pause(2000);

    // Get the new last line after toggling
    lastLineAfter = await getLastLineOfOutputView(bottomBar);
    expect(lastLineBefore).toEqual(lastLineAfter);

    // Close all editors at the end of the test
    await workbench.getEditorView().closeAllEditors();
  });

  it("should set version to vc24_sp5", async () => {
    const outputView = await bottomBar.openOutputView();
    // Check if we are on CI
    let vcastRoot: string;
    if (process.env.HOME.startsWith("/github")) {
      vcastRoot = "/vcast";
    } else {
      // Assuming that locally release is on this path.
      vcastRoot = path.join(process.env.HOME, "vcast");
    }

    const newVersion = "release24_sp5";
    const release24Path = path.join(vcastRoot, newVersion);

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    // Put in release 24_sp5 path in settings
    const settingsEditor = await workbench.openSettings();
    const unitTestLocationSetting = await settingsEditor.findSetting(
      "Vectorcast Installation Location",
      "Vectorcast Test Explorer"
    );

    await unitTestLocationSetting.setValue(release24Path);

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Started VectorCAST Data Server"),
      { timeout: TIMEOUT }
    );

    let statusBar = workbench.getStatusBar();
    await browser.waitUntil(
      async () => (await statusBar.getItems()).includes("vDataServer On"),
      { timeout: TIMEOUT }
    );

    // Set path back again to something "junk"
    await unitTestLocationSetting.setValue("junk");

    //Need to clear, otherwise we won't wait for the message as it is already there from the steps before
    outputView.clearText();
    await bottomBar.toggle(true);

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("VectorCAST Data Server exited successfully"),
      { timeout: TIMEOUT }
    );

    // When setting to a wrong path, vDataServer Status Button should be disabled
    const statusBarInfos = await statusBar.getItems();
    expect(statusBarInfos.includes("vDataServer On")).toBe(false);
    expect(statusBarInfos.includes("vDataServer Off")).toBe(false);
  });
});
