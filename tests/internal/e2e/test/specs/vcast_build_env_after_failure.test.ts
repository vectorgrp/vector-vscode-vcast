import { type BottomBarPanel, type Workbench } from "wdio-vscode-service";
import {
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
  cleanup,
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

  it("should activate vcastAdapter", async () => {
    await updateTestID();
    const activityBar = workbench.getActivityBar();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();

    //Open Settings and put in valid path
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
  });

  // it("should clean up", async () => {
  //   await updateTestID();
  //   await cleanup();
  // });
});
