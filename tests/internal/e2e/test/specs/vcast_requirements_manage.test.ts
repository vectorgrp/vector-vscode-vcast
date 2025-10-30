import {
  type BottomBarPanel,
  type Workbench,
  TextEditor,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  checkElementExistsInHTML,
  executeContextMenuAction,
  findTreeNodeAtLevel,
  getViewContent,
  selectOutputChannel,
  updateTestID,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";
import { checkForServerRunnability } from "../../../../unit/getToolversion";

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
    // Wait for the output channel to be populated
    // ── guard the channel‐select so a failure doesn’t abort the test ──
    try {
      await browser.waitUntil(async () =>
        (await outputView.getChannelNames())
          .toString()
          .includes("VectorCAST Requirement Test Generation Operations")
      );
      await outputView.selectChannel(
        "VectorCAST Requirement Test Generation Operations"
      );
      console.log("Channel selected");
    } catch (err) {
      console.warn("selectChannel failed, continuing anyway:", err.message);
    }

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
  });

  it("should enable/disable Reqs2X and set path to ressources on github", async () => {
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    // Open Settings
    const settingsEditor2 = await workbench.openSettings();
    // Put in path to ressources
    const resourcePathSetting = await settingsEditor2.findSetting(
      "Installation Location",
      "Vectorcast Test Explorer › Reqs2x"
    );
    console.log(
      `Setting Reqs2x installation location: ${process.env.REQS2TESTS_RESOURCES ?? "Failed to find Resources"}`
    );
    await resourcePathSetting.setValue(process.env.REQS2TESTS_RESOURCES ?? "");
    await workbench.getEditorView().closeAllEditors();

    // Open Settings
    const settingsEditor = await workbench.openSettings();

    // 1) Enable Reqs2X
    const enabledSetting = await settingsEditor.findSetting(
      "Enable Reqs2x Feature",
      "Vectorcast Test Explorer › Reqs2x"
    );
    await enabledSetting.setValue(true);
    await workbench.getEditorView().closeAllEditors();
  });

  it("should configure Reqs2X to use OpenAI and set api key, model and base URL", async () => {
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    // Open Settings
    const settingsEditor = await workbench.openSettings();

    console.log("Setting Provider");

    // 2) Select provider
    const providerSetting = await settingsEditor.findSetting(
      "Provider",
      "Vectorcast Test Explorer › Reqs2x"
    );
    await providerSetting.setValue("azure_openai");
    await workbench.getEditorView().closeAllEditors();

    // 3) Set API key
    console.log("Setting API Key");
    const settingsEditor2 = await workbench.openSettings();
    const apiKeySetting = await settingsEditor2.findSetting(
      "Api Key",
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    console.log(`API key length: ${process.env.OPENAI_API_KEY.length}`);
    await apiKeySetting.setValue(
      process.env.OPENAI_API_KEY ?? "Failed to find API Key"
    );
    await workbench.getEditorView().closeAllEditors();

    // 4) Set Base URL
    console.log(
      `Setting Base URL ${process.env.AZURE_BASE_URL ?? "Failed to find Base URL"}`
    );
    const settingsEditor3 = await workbench.openSettings();
    const urlSetting = await settingsEditor3.findSetting(
      "Base Url",
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    await urlSetting.setValue(
      process.env.AZURE_BASE_URL ?? "Failed to find Base URL"
    );
    console.log(`length of BASE URL: ${process.env.AZURE_BASE_URL.length}`);
    await workbench.getEditorView().closeAllEditors();

    // 4) Set Base URL
    console.log("Setting Deployment");
    const settingsEditor4 = await workbench.openSettings();
    const deployementSetting = await settingsEditor4.findSetting(
      "Deployment",
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    await deployementSetting.setValue("gpt-4.1-mini");
    await workbench.getEditorView().closeAllEditors();

    // 5) Set Model Name
    console.log("Setting Model Name");
    const settingsEditor5 = await workbench.openSettings();
    const modelSetting = await settingsEditor5.findSetting(
      "Model Name",
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    await modelSetting.setValue("gpt-4.1-mini");
    await workbench.getEditorView().closeAllEditors();

    // 6) Checking API Version
    console.log("Checking API Version");
    const settingsEditor6 = await workbench.openSettings();
    const previewSetting = await settingsEditor6.findSetting(
      "Api Version",
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    await previewSetting.setValue("2024-12-01-preview");
    await workbench.getEditorView().closeAllEditors();
  });

  it("should generate requirements", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const outputView = await bottomBar.openOutputView();
    // ── guard the channel‐select so a failure doesn’t abort the test ──
    try {
      await outputView.selectChannel(
        "VectorCAST Requirement Test Generation Operations"
      );
      console.log("Channel selected");
    } catch (err) {
      console.warn("selectChannel failed, continuing anyway:", err.message);
    }
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
    const vcastTestingViewContent = await getViewContent("Testing");

    await (await vcastTestingViewContent.elem).click();
    const sections = await vcastTestingViewContent.getSections();
    const testExplorerSection = sections[0];
    await testExplorerSection.getVisibleItems();

    await executeContextMenuAction(2, "BAR", true, "Generate Requirements");

    // Should exit with code 0
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("code2reqs completed successfully with code 0"),
      { timeout: 180_000 }
    );
  });

  it("should show requirements", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
    const vcastTestingViewContent = await getViewContent("Testing");

    await (await vcastTestingViewContent.elem).click();
    const sections = await vcastTestingViewContent.getSections();
    const testExplorerSection = sections[0];
    const testEnvironments = await testExplorerSection.getVisibleItems();

    await executeContextMenuAction(2, "BAR", true, "Show Requirements");

    const editorView = workbench.getEditorView();
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "Requirements Report"
    );

    (await editorView.openEditor("Requirements Report")) as TextEditor;

    // Expect some HTML stuff to be present
    expect(await checkElementExistsInHTML("Requirements")).toBe(true);
    expect(await checkElementExistsInHTML("bar")).toBe(true);
    expect(await checkElementExistsInHTML("bar.1")).toBe(true);

    await editorView.closeEditor("Requirements Report", 0);
  });

  it("should generate requirements tests", async () => {
    await updateTestID();

    // Find Manager::PlaceOrder subprogram and click on Generate Tests
    await executeContextMenuAction(
      3,
      "bar",
      true,
      "Generate Tests from Requirements"
    );

    await bottomBar.maximize();
    await browser.pause(60000);

    const outputView = await bottomBar.openOutputView();

    console.log(await outputView.getText());

    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("Script loaded successfully"),
      { timeout: 180_000 }
    );

    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("returned exit code: 0"),
      { timeout: 180_000 }
    );
  });
});
