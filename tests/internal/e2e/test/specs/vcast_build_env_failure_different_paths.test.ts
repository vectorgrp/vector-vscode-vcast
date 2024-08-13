// Test/specs/vcast.test.ts
import process from "node:process";
import path from "node:path";
import {
  type TreeItem,
  type ViewContent,
  ViewItem,
  ViewSection,
  type BottomBarPanel,
  type Workbench,
  CustomTreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
  getViewContent,
  expandTopEnvInTestPane,
  retrieveTestingTopItems,
} from "../test_utils/vcast_utils";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  const TIMEOUT = 60_000;
  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    process.env.E2E_TEST_ID = "0";
    // Initialize the unitTestLocationSetting
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

  it("should confirm the presence of ENV_23_01 and ENV_23_03", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();

    // Open Testing
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();

    let vcastTestingViewContent: ViewContent;
    let env1Item: ViewItem;
    let env3Item: ViewItem;
    let env2Item: ViewItem;
    let env4Item: ViewItem;

    // Iterate through Testing and try to expand builded Envs (2 & 4)
    vcastTestingViewContent = await getViewContent("Testing");
    const topLevelItems = await retrieveTestingTopItems(
      vcastTestingViewContent
    );

    // Expand and check ENV_01 and ENV_03 exist and ENV_02 and ENV_04 not
    env1Item = await expandTopEnvInTestPane(
      "ENV_23_01",
      topLevelItems as CustomTreeItem[]
    );
    env3Item = await expandTopEnvInTestPane(
      "ENV_23_03",
      topLevelItems as CustomTreeItem[]
    );
    env2Item = await expandTopEnvInTestPane(
      "ENV_24_02",
      topLevelItems as CustomTreeItem[]
    );
    env4Item = await expandTopEnvInTestPane(
      "ENV_24_04",
      topLevelItems as CustomTreeItem[]
    );

    expect(env1Item).not.toBe(undefined);
    expect(env3Item).not.toBe(undefined);
    expect(env2Item).toBe(undefined);
    expect(env4Item).toBe(undefined);
  });

  it("should change to release 24 and confirm the presence of ENV_24_02 and ENV_24_04", async () => {
    // Release 24
    const vcastRoot = path.join(process.env.HOME, "vcast");
    const newVersion = "release24";
    const release24Path = path.join(vcastRoot, newVersion);

    await updateTestID();
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    // Put in release 24 path in settings
    const settingsEditor = await workbench.openSettings();
    const unitTestLocationSetting = await settingsEditor.findSetting(
      "Vectorcast Installation Location",
      "Vectorcast Test Explorer"
    );
    await unitTestLocationSetting.setValue(release24Path);

    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();

    // Ignore ENV_01
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Ignoring environment"),
      { timeout: TIMEOUT }
    );
    // Build ENV_02
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment"),
      { timeout: TIMEOUT }
    );
    // Ignore ENV_03
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Ignoring environment"),
      { timeout: TIMEOUT }
    );
    // Build ENV_04
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment"),
      { timeout: TIMEOUT }
    );

    // Open Testing
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();

    let vcastTestingViewContent: ViewContent;
    let env2Item: ViewItem;
    let env4Item: ViewItem;
    let env1Item: ViewItem;
    let env3Item: ViewItem;

    // Iterate through Testing and try to expand builded Envs (2 & 4)
    vcastTestingViewContent = await getViewContent("Testing");
    const topLevelItems = await retrieveTestingTopItems(
      vcastTestingViewContent
    );

    // Expand and check ENV_02 and ENV_04 exist and ENV_01 and ENV_03 not
    env2Item = await expandTopEnvInTestPane(
      "ENV_24_02",
      topLevelItems as CustomTreeItem[]
    );
    env4Item = await expandTopEnvInTestPane(
      "ENV_24_04",
      topLevelItems as CustomTreeItem[]
    );
    env1Item = await expandTopEnvInTestPane(
      "ENV_23_01",
      topLevelItems as CustomTreeItem[]
    );
    env3Item = await expandTopEnvInTestPane(
      "ENV_23_03",
      topLevelItems as CustomTreeItem[]
    );

    expect(env2Item).not.toBe(undefined);
    expect(env4Item).not.toBe(undefined);
    expect(env1Item).toBe(undefined);
    expect(env3Item).toBe(undefined);
  });
});
