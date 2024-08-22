// Test/specs/vcast_coded_tests.test.ts
import {
  type BottomBarPanel,
  type StatusBar,
  type TextEditor,
  type Workbench,
  type TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  releaseCtrl,
  executeCtrlClickOn,
  expandWorkspaceFolderSectionInExplorer,
  clickOnButtonInTestingHeader,
  getViewContent,
  findSubprogram,
  getTestHandle,
  findSubprogramMethod,
  updateTestID,
  normalizeContentAssistString,
  getGeneratedTooltipTextAt,
} from "../test_utils/vcast_utils";

// Define the normalized version of the expected content
export const normalizedExpectedFunctionOutput = `
  void vmock_manager_Manager_ClearTable(::vunit::CallCtx<Manager> vunit_ctx, unsigned Table) {
    // Enable Stub: vmock_manager_Manager_ClearTable_enable_disable(vmock_session);
    // Disable Stub: vmock_manager_Manager_ClearTable_enable_disable(vmock_session, false);
  
    // Insert mock logic here!
  }
  void vmock_manager_Manager_ClearTable_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
      using vcast_mock_rtype = void  ;
      vcast_mock_rtype (Manager::*vcast_fn_ptr)(unsigned)  = &Manager::ClearTable;
      vmock_session.mock <vcast_mock_rtype (Manager::*)(unsigned)> ((vcast_mock_rtype (Manager::*)(unsigned))vcast_fn_ptr).assign (enable ? &vmock_manager_Manager_ClearTable : nullptr);
  }
  // end of mock for: vmock_manager_Manager_ClearTable -------------------------------------------------------------------
  `.trim();

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let statusBar: StatusBar;
  const TIMEOUT = 120_000;
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

  it("should enable coded testing", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const settingsEditor = await workbench.openSettings();
    console.log("Looking for coded tests settings");
    await settingsEditor.findSetting(
      "vectorcastTestExplorer.enableCodedTesting"
    );
    // Only one setting in search results, so the current way of clicking is correct
    console.log("Enabling coded tests");
    await (await settingsEditor.checkboxSetting$).click();
    await workbench.getEditorView().closeAllEditors();
  });

  it("should check for vmock code completion", async () => {
    await updateTestID();

    console.log("Opening Testing View");
    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;
    let testHandle: TreeItem;
    // Expand manager section in testing pane.
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("moo", vcastTestingViewSection);
      if (subprogram) {
        if (!(await subprogram.isExpanded())) await subprogram.expand();
        console.log("Getting test handle");
        testHandle = await getTestHandle(
          subprogram,
          "Coded Tests",
          "mooTests.ExampleTestCase",
          1
        );
        if (testHandle) {
          break;
        } else {
          throw "Test handle not found for mooTests.ExampleTestCase";
        }
      }
    }
    expect(testHandle).not.toBe(undefined);

    let contextMenu = await testHandle.openContextMenu();
    await contextMenu.select("VectorCAST");
    let menuElement = await $("aria/Edit Coded Test");
    await menuElement.click();

    const editorView = workbench.getEditorView();
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) === "tests.cpp"
    );

    const tab = (await editorView.openEditor("tests.cpp")) as TextEditor;
    await browser.keys([Key.Ctrl, Key.Space]);

    await tab.setTextAtLine(14, "// vmock");
    let currentLine = await tab.getLineOfText("// vmock");
    await tab.typeTextAt(currentLine, "// vmock".length + 1, " ");
    await tab.save();

    const hoverText = await getGeneratedTooltipTextAt(
      currentLine,
      "// vmock".length - 1,
      tab
    );
    const expectedText = `This environment does not support mocks, no auto-completion is available. Rebuild the environment to use mocks`;
    expect(normalizeContentAssistString(hoverText)).toContain(
      normalizeContentAssistString(expectedText)
    );
  });
});
