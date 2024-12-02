// Test/specs/vcast.test.ts
import {
  type BottomBarPanel,
  type Workbench,
  CustomTreeItem,
  EditorView,
  TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  getViewContent,
  updateTestID,
  generateMCDCReportFromGutter,
  checkElementExistsInHTML,
  findSubprogram,
  getTestHandle,
  executeCtrlClickOn,
  releaseCtrl,
  expandWorkspaceFolderSectionInExplorer,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";
import { checkForServerRunnability } from "../../../../unit/getToolversion";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  let useDataServer: boolean = true;
  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    editorView = workbench.getEditorView();
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
  });

  it("should change coverageKind and Rebuild env", async () => {
    // We need to change the covarage kind to Statement+MCDC in order to get the MCDC lines
    let settingsEditor = await workbench.openSettings();
    const coverageKindSetting = await settingsEditor.findSetting(
      "Coverage Kind",
      "Vectorcast Test Explorer",
      "Build"
    );
    const coverageKindValue = await coverageKindSetting.getValue();
    expect(coverageKindValue).toEqual("Statement");
    await coverageKindSetting.setValue("Statement+MCDC");

    workbench = await browser.getWorkbench();
    const vcastTestingViewContent = await getViewContent("Testing");
    const envName = "cpp/unitTests/DATABASE-MANAGER";

    // When we change the coverage kind --> rebuild env to take effect
    console.log("Re-Building Environment from Test Explorer");
    // Flask --> Right-click on env --> Re-Build environment
    for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
      for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
        await visibleItem.select();

        const subprogramGroup = visibleItem as CustomTreeItem;
        if ((await subprogramGroup.getTooltip()).includes(envName)) {
          await subprogramGroup.expand();
          const menuItemLabel = "Re-Build Environment";
          const contextMenu = await subprogramGroup.openContextMenu();
          await contextMenu.select("VectorCAST");
          await (await $(`aria/${menuItemLabel}`)).click();
          break;
        }
      }
    }
    const outputView = await bottomBar.openOutputView();
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Environment re-build complete"),
      { timeout: TIMEOUT }
    );
  });

  it("should run myFirstTest and check its report", async () => {
    // When we rebuild the env, we need to run the test again because the coverage gutter icons are reseted
    // --> We want to check Red and Green mcdc lines, otherwise we would only have red ones
    await updateTestID();
    console.log("Looking for Manager::PlaceOrder in the test tree");

    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem;
    let testHandle: TreeItem;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "myFirstTest",
          1
        );
        if (testHandle) {
          break;
        } else {
          throw new Error("Test handle not found for myFirstTest");
        }
      }
    }

    if (!subprogram) {
      throw new Error("Subprogram 'manager' not found");
    }

    console.log("Running myFirstTest");
    await testHandle.select();
    await (await (await testHandle.getActionButton("Run Test")).elem).click();

    // It is expected that the VectorCast Report WebView is the only existing WebView at the moment
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );

    let webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    let webview = webviews[0];

    await webview.open();

    expect(await checkElementExistsInHTML("Execution Results (PASS)")).toBe(
      true
    );
    expect(
      await checkElementExistsInHTML("Event 1 - Calling Manager::PlaceOrder")
    ).toBe(true);
    expect(
      await checkElementExistsInHTML(
        "Event 2 - Returned from Manager::PlaceOrder"
      )
    ).toBe(true);

    await expect($(".text-muted*=UUT")).toHaveText("UUT: manager.cpp");

    await expect($(".subprogram*=Manager")).toHaveText("Manager::PlaceOrder");

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);

    console.log("Validating info messages in output channel of the bottom bar");
    await bottomBar.maximize();
    await browser.waitUntil(async () =>
      (await (await bottomBar.openOutputView()).getText()).includes(
        "test explorer  [info]  Starting execution of test: myFirstTest ..."
      )
    );
    const outputViewText = await (await bottomBar.openOutputView()).getText();
    await bottomBar.restore();
    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Processing environment data for:");
      })
    ).not.toBe(undefined);

    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Viewing results, result report path");
      })
    ).not.toBe(undefined);
    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Creating web view panel");
      })
    ).not.toBe(undefined);

    expect(
      outputViewText.find(function (line): boolean {
        return line.includes("Setting webview text");
      })
    ).not.toBe(undefined);
  });

  it("should check if covered mcdc line generates mcdc report", async () => {
    const outputView = await bottomBar.openOutputView();
    // Green MCDC Gutter icon
    await generateMCDCReportFromGutter(
      22,
      "manager.cpp",
      "cover-icon-with-mcdc",
      false
    );
    await browser.waitUntil(
      async () => (await outputView.getText()).toString().includes("REPORT:"),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    let webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    let webview = webviews[0];

    await webview.open();

    // Some important lines we want to check for in the report
    await expect(await checkElementExistsInHTML("manager.cpp")).toBe(true);

    await expect(await checkElementExistsInHTML("22")).toBe(true);

    await expect(await checkElementExistsInHTML("((a && b) && c)")).toBe(true);

    await webview.close();

    // Generating another report for a valid line to verify the bug
    // that prevented report generation without prior interaction with the editor.
    // Both calls use the "false" flag for this reason.
    await generateMCDCReportFromGutter(
      19,
      "manager.cpp",
      "cover-icon-with-mcdc",
      false
    );
    await browser.waitUntil(
      async () => (await outputView.getText()).toString().includes("REPORT:"),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    webview = webviews[0];

    await webview.open();

    // Some important lines we want to check for in the report
    await expect(await checkElementExistsInHTML("manager.cpp")).toBe(true);

    await expect(await checkElementExistsInHTML("19")).toBe(true);

    await webview.close();
  });

  it("should check if uncovered mcdc line generates mcdc report", async () => {
    workbench = await browser.getWorkbench();
    bottomBar = workbench.getBottomBar();
    const outputView = await bottomBar.openOutputView();
    // Red MCDC Gutter icon
    await generateMCDCReportFromGutter(
      84,
      "manager.cpp",
      "no-cover-icon-with-mcdc",
      true
    );
    await browser.waitUntil(
      async () => (await outputView.getText()).toString().includes("REPORT:"),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();

    // Retrieve the HTML and count the number of div.report-block
    const reportBlockCount = await browser.execute(() => {
      // Use querySelectorAll to count how many <div class="report-block"> elements are in the document
      return document.querySelectorAll("div.report-block").length;
    });

    expect(reportBlockCount).toEqual(1);

    // Some important lines we want to check for in the report
    await expect(await checkElementExistsInHTML("manager.cpp")).toBe(true);

    await expect(await checkElementExistsInHTML("84")).toBe(true);

    await expect(await checkElementExistsInHTML("WaitingListSize > (9)")).toBe(
      true
    );

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });

  it("should build new env with nearly identical files and check for mcdc report", async () => {
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");

    const mooCpp = await workspaceFolderSection.findItem("moo.cpp");
    const fooCpp = await workspaceFolderSection.findItem("foo.cpp");
    await executeCtrlClickOn(mooCpp);
    await executeCtrlClickOn(fooCpp);
    await releaseCtrl();

    await fooCpp.openContextMenu();
    await (await $("aria/Create VectorCAST Environment")).click();

    // Making sure notifications are shown
    await (await $("aria/Notifications")).click();

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

    const outputView = await bottomBar.openOutputView();

    // Red MCDC Gutter icon
    await generateMCDCReportFromGutter(
      15,
      "foo.cpp",
      "no-cover-icon-with-mcdc",
      true
    );
    await browser.waitUntil(
      async () => (await outputView.getText()).toString().includes("REPORT:"),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();

    // Retrieve the HTML and count the number of div.mcdc-condition no-cvg
    const reportBlockCount = await browser.execute(() => {
      // Use querySelectorAll to count how many <div class="mcdc-condition.no-cvg"> elements are in the document
      // In the double report bug there were 2
      return document.querySelectorAll("div.mcdc-condition.no-cvg").length;
    });

    expect(reportBlockCount).toEqual(1);

    // Some important lines we want to check for in the report
    await expect(await checkElementExistsInHTML("foo.cpp")).toBe(true);

    await expect(await checkElementExistsInHTML("15")).toBe(true);

    await webview.close();
  });
});
