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
  type CustomTreeItem,
  type OutputView,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
  getViewContent,
  expandTopEnvInTestPane,
  retrieveTestingTopItems,
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
    // Initialize the unitTestLocationSetting
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

    console.log("Waiting for VectorCAST activation");
    await $("aria/VectorCAST Test Pane Initialization");
    console.log("WAITING FOR TESTING");
    await browser.waitUntil(
      async () => (await activityBar.getViewControl("Testing")) !== undefined,
      { timeout: TIMEOUT }
    );
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
  });

  it("should set default config file", async () => {
    await updateTestID();

    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
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

    await expectEnvResults("2023sp0");
  });

  it("should change to release 24 and confirm the presence of ENV_24_02 and ENV_24_04", async () => {
    // Release 24
    await updateTestID();

    // Check if we are on CI
    let vcastRoot: string;
    if (process.env.HOME.startsWith("/github")) {
      vcastRoot = "/vcast";
    } else {
      // Assuming that locally release is on this path.
      vcastRoot = path.join(process.env.HOME, "vcast");
    }

    const newVersion = "2024sp4";
    const release24Path = path.join(vcastRoot, newVersion);

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

    await awaitOutputtext(outputView, "ENV_23_01", true, TIMEOUT);
    await awaitOutputtext(outputView, "ENV_24_02", false, TIMEOUT);
    await awaitOutputtext(outputView, "ENV_23_03", true, TIMEOUT);
    await awaitOutputtext(outputView, "ENV_24_04", false, TIMEOUT);

    // Open Testing
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();

    await expectEnvResults("2024sp4");
  });
});

/**
 * Function retrieves the top env folder and expects the correct results.
 * @param release Release version.
 */
async function expectEnvResults(release: string) {
  const envMap = new Map<string, Array<{ env: string; state: string }>>([
    [
      "2023sp0",
      [
        { env: "ENV_23_01", state: "defined" },
        { env: "ENV_24_02", state: "undefined" },
        { env: "ENV_23_03", state: "defined" },
        { env: "ENV_24_04", state: "undefined" },
      ],
    ],
    // Envs are there as nodes but not build
    [
      "2024sp4",
      [
        { env: "ENV_23_01", state: "defined" },
        { env: "ENV_24_02", state: "defined" },
        { env: "ENV_23_03", state: "defined" },
        { env: "ENV_24_04", state: "defined" },
      ],
    ],
  ]);

  let vcastTestingViewContent: ViewContent;

  // Iterate through Testing and try to expand builded Envs (2 & 4)
  vcastTestingViewContent = await getViewContent("Testing");
  const topLevelItems = await retrieveTestingTopItems(vcastTestingViewContent);

  const release23Value = envMap.get(release);

  // Iterate thorugh map, expand and check based on release what ENV should be defined.
  for (const entry of release23Value) {
    const envResult = await expandTopEnvInTestPane(
      entry.env,
      topLevelItems as CustomTreeItem[]
    );
    if (entry.state === "defined") {
      expect(envResult).not.toBe(undefined);
    } else {
      expect(envResult).toBe(undefined);
    }
  }
}

/**
 * Function to await for the correct output text based on the env.
 * @param outputView Vscode Outputview.
 * @param env ENV name.
 * @param ignore Boolean whether we expect to ignore ENV or process.
 * @param TIMEOUT Timeout limit.
 */
async function awaitOutputtext(
  outputView: OutputView,
  env: string,
  ignore: boolean,
  TIMEOUT: number
) {
  if (ignore) {
    await browser.waitUntil(
      async () => {
        const outputText = (await outputView.getText()).toString();
        return (
          outputText.includes("Ignoring environment") &&
          outputText.includes(env)
        );
      },
      { timeout: TIMEOUT }
    );
  } else {
    await browser.waitUntil(
      async () => {
        const outputText = (await outputView.getText()).toString();
        return (
          outputText.includes("Processing environment") &&
          outputText.includes(env)
        );
      },
      { timeout: TIMEOUT }
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));
}
