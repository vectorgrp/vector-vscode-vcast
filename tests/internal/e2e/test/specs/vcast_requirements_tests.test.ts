import {
  type BottomBarPanel,
  type Workbench,
  CustomTreeItem,
  TextEditor,
  TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  checkElementExistsInHTML,
  checkForGutterAndGenerateReport,
  findSubprogram,
  findSubprogramMethod,
  findTreeNodeAtLevel,
  getViewContent,
  updateTestID,
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
        .includes("VectorCAST Requirement Test Generation Operations")
    );
    await outputView.selectChannel(
      "VectorCAST Requirement Test Generation Operations"
    );
    console.log("Channel selected");

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
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

  it("should generate requirements", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const outputView = await bottomBar.openOutputView();
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
    const vcastTestingViewContent = await getViewContent("Testing");

    await (await vcastTestingViewContent.elem).click();
    const sections = await vcastTestingViewContent.getSections();
    const testExplorerSection = sections[0];
    const testEnvironments = await testExplorerSection.getVisibleItems();

    // Go thorugh the (only) env and click on Generate Requirements
    for (const testEnvironment of testEnvironments) {
      let testEnvironmentContextMenu;

      try {
        testEnvironmentContextMenu = await (
          testEnvironment as CustomTreeItem
        ).openContextMenu();
      } catch {
        console.log("Cannot open context menu, not an environment");
        break;
      }

      if (testEnvironmentContextMenu != undefined) {
        await testEnvironmentContextMenu.select("VectorCAST");
        const generateButton = await $("aria/Generate Requirements");
        if (generateButton == undefined) break;

        await generateButton.click();

        const vcastNotificationSourceElement = await $(
          "aria/VectorCAST Test Explorer (Extension)"
        );
        const vcastNotification = await vcastNotificationSourceElement.$("..");
        await (await vcastNotification.$("aria/Continue")).click();

        // Should exit with code 0
        await browser.waitUntil(
          async () =>
            (await (await bottomBar.openOutputView()).getText())
              .toString()
              .includes("code2reqs completed successfully with code 0"),
          { timeout: 180_000 }
        );
      }
    }
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

    // CLick on Show Requirements for the (only) env
    for (const testEnvironment of testEnvironments) {
      let testEnvironmentContextMenu;

      try {
        testEnvironmentContextMenu = await (
          testEnvironment as CustomTreeItem
        ).openContextMenu();
      } catch {
        console.log("Cannot open context menu, not an environment");
        break;
      }

      if (testEnvironmentContextMenu != undefined) {
        await testEnvironmentContextMenu.select("VectorCAST");
        const importButton = await $("aria/Show Requirements");
        if (importButton == undefined) break;

        await importButton.click();

        const editorView = workbench.getEditorView();
        await browser.waitUntil(
          async () =>
            (await (await editorView.getActiveTab()).getTitle()) ===
            "Requirements Report"
        );

        const tab = (await editorView.openEditor(
          "Requirements Report"
        )) as TextEditor;

        // Expect some HTML stuff to be present
        expect(await checkElementExistsInHTML("extreme.1")).toBe(true);
        expect(await checkElementExistsInHTML("extreme.2")).toBe(true);
        expect(await checkElementExistsInHTML("extreme.3")).toBe(true);
        expect(await checkElementExistsInHTML("extreme.4")).toBe(true);

        await editorView.closeEditor("Requirements Report", 0);
      }
    }
  });

  it("should generate requirements tests", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    const outputView = await bottomBar.openOutputView();

    // Find Manager::PlaceOrder subprogram and click on Generate Tests
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded()))
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand();
        subprogram = await findSubprogram(
          "moo",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          if (!(await subprogram.isExpanded())) await subprogram.expand();
          break;
        }
      }
    }

    if (!subprogram) {
      throw new Error("Subprogram 'moo' not found");
    }

    const subprogramMethod = await findSubprogramMethod(subprogram, "extreme");
    if (!subprogramMethod) {
      throw new Error("Subprogram method 'extreme' not found");
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }

    await outputView.clearText();

    const contextMenu = await subprogramMethod.openContextMenu();
    await contextMenu.select("VectorCAST");
    const menuElement = await $("aria/Generate Tests from Requirements");
    await menuElement.click();

    // 2025sp1 shows the first log and then doesnt switch back to the other output channel.
    try {
      // First, try waiting for the "reqs2tests" log
      await browser.waitUntil(
        async () =>
          (await (await bottomBar.openOutputView()).getText())
            .toString()
            .includes("reqs2tests completed successfully with code 0"),
        { timeout: 240_000 }
      );
    } catch (err) {
      // If that fails, fall back to "Processing environment data"
      try {
        await browser.waitUntil(
          async () =>
            (await (await bottomBar.openOutputView()).getText())
              .toString()
              .includes("Processing environment data for:"),
          { timeout: 240_000 }
        );
      } catch (err2) {
        // Both attempts failed → rethrow the first error (or combine them)
        throw new Error(
          `Neither log message appeared within the timeout.\n` +
            `First error: ${err}\nSecond error: ${err2}`
        );
      }
    }

    await (
      await (
        await subprogramMethod.getActionButton("Run Test")
      ).elem
    ).click();

    // -------- Coverage validation --------

    // Because ATG generates tests with different names, we cannot "hard check" for existing tests.
    // Only checking for the log is not enough. So we iterate thorugh the function for which we generated the tests
    // And expect to have only green icons or no icons (empty lines, brackets, ...)
    console.log("Validating Coverage icons for moo::extreme");
    const GREEN_GUTTER = "cover-icon";

    const requiredGreenLines = new Set<number>([7, 9, 11, 13]);

    const missingRequired: number[] = [];

    for (let line = 6; line <= 13; line++) {
      console.log(`Checking gutter on line ${line} in moo.cpp`);

      try {
        await checkForGutterAndGenerateReport(
          line,
          "moo.cpp",
          GREEN_GUTTER,
          true, // move cursor so line is visible
          false // don't generate report
        );
        console.log(`Line ${line} has a green gutter`);
      } catch (err) {
        if (requiredGreenLines.has(line)) {
          missingRequired.push(line);
        } else {
          console.log(`Line ${line} has no gutter (allowed)`);
        }
      }
    }

    if (missingRequired.length > 0) {
      throw new Error(
        `Missing required green gutters on lines: ${missingRequired.join(", ")}`
      );
    }
  });
});
