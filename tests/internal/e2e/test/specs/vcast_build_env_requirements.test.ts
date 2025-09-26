// Test/specs/vcast.test.ts
import { type BottomBarPanel, type Workbench } from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  releaseCtrl,
  executeCtrlClickOn,
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
  checkIfRequestInLogs,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";
import { checkForServerRunnability } from "../../../../unit/getToolversion";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let useDataServer: boolean = true;
  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
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

  it("should check for server starting logs if in server mode", async () => {
    const outputView = await bottomBar.openOutputView();

    // Check if server started
    if (useDataServer) {
      // Check message pane for expected message
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes("Started VectorCAST Data Server"),
        { timeout: TIMEOUT }
      );

      // Check server logs
      const logs = await checkIfRequestInLogs(3, ["port:", "clicast"]);
      expect(logs).toBe(true);
    }
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

    const mooCpp = await workspaceFolderSection.findItem("moo.cpp");
    await executeCtrlClickOn(mooCpp);
    await releaseCtrl();

    await mooCpp.openContextMenu();
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
    const editorView = workbench.getEditorView();
    await editorView.closeEditor("moo.cpp", 0);
  });
});
