// Test/specs/vcast.test.ts
import {
  TextEditor,
  type BottomBarPanel,
  type Workbench,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  releaseCtrl,
  executeCtrlClickOn,
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
  checkIfRequestInLogs,
  checkElementExistsInHTML,
  findTreeNodeAtLevel,
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
    browser.pause(10000);
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

  it("should check for vcp node", async () => {
    const outputView = await bottomBar.openOutputView();
    const activityBar = workbench.getActivityBar();
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
    const vcpNode = await findTreeNodeAtLevel(0, "env.vcp");
    expect(vcpNode).toBeDefined();
  });

  it("should check for c coverage", async () => {
    workbench = await browser.getWorkbench();
    bottomBar = workbench.getBottomBar();
    const activityBar = workbench.getActivityBar();
    const testingView = await activityBar.getViewControl("Explorer");
    await testingView?.openView();

    await bottomBar.toggle(false);

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");

    const workFolder = workspaceFolderSection.findItem("work");
    await (await workFolder).select();

    const luaFolder = workspaceFolderSection.findItem("lua-5.4.0");
    await (await luaFolder).select();

    const srcFolder = workspaceFolderSection.findItem("src");
    await (await srcFolder).select();

    const file = workspaceFolderSection.findItem("lua.c");
    await (await file).select();

    // Check if the file is already open in the editor
    const editorView = workbench.getEditorView();
    const openEditors = await editorView.getOpenEditorTitles();
    const isFileOpen = openEditors.includes("lua.c");

    if (!isFileOpen) {
      await (await file).select();
    }

    // Give VS Code some time to settle (language server, decorations, etc.)
    await browser.pause(30_000);

    const icon = "no-cover-icon-with-mcdc";
    const lineNumber = 65;

    const tab = (await editorView.openEditor("lua.c")) as TextEditor;
    await tab.moveCursor(lineNumber, 1);

    // Use the EXACT same pattern as the working test
    const lineNumberElement = await $(`.line-numbers=${lineNumber}`);
    const flaskElement = await (
      await lineNumberElement.parentElement()
    ).$(".cgmr.codicon");

    // Verify the icon
    const backgroundImageCSS =
      await flaskElement.getCSSProperty("background-image");
    expect(backgroundImageCSS.value.includes(`/${icon}`)).toBe(true);

    // Close bottom bar before context menu
    await bottomBar.toggle(false);
    await browser.pause(1000);

    // Open context menu
    await flaskElement.click({ button: 2 });
    await browser.pause(2000);
    await (await $("aria/VectorCAST MC/DC Report")).click();

    const outputView = await bottomBar.openOutputView();

    // Wait for report generation
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Report file path is:"),
      { timeout: TIMEOUT }
    );

    // Wait for webview to open
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );

    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);

    const webview = webviews[0];
    await webview.open();

    // Count report blocks in the HTML
    const reportBlockCount = await browser.execute(() => {
      return document.querySelectorAll("div.report-block").length;
    });

    expect(reportBlockCount).toEqual(1);

    // Validate report content
    await expect(await checkElementExistsInHTML("lua.c")).toBe(true);
    await expect(await checkElementExistsInHTML("65")).toBe(true);
    await expect(
      await checkElementExistsInHTML("Pairs satisfied: 0 of 2 ( 0% )")
    ).toBe(true);

    // Cleanup
    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });
});
