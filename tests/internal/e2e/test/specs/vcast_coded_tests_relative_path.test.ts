// Test/specs/vcast.test.ts
import {
  type BottomBarPanel,
  type TextEditor,
  type Workbench,
  type TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  getViewContent,
  findSubprogram,
  updateTestID,
  expandWorkspaceFolderSectionInExplorer,
  getTestHandle,
} from "../test_utils/vcast_utils";

import { TIMEOUT } from "../test_utils/vcast_utils";
import { getToolVersion } from "../../../../unit/getToolversion";

describe("vTypeCheck VS Code Extension", async () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  const toolVersion = await getToolVersion();
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
    if (toolVersion <= 25) {
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
    } else {
      console.log(
        "Skipping set default config file test for tool version > 25"
      );
    }
  });

  it("should set default config file", async () => {
    await updateTestID();
    if (toolVersion <= 25) {
      const workbench = await browser.getWorkbench();
      const activityBar = workbench.getActivityBar();
      const explorerView = await activityBar.getViewControl("Explorer");
      await explorerView?.openView();

      const workspaceFolderSection =
        await expandWorkspaceFolderSectionInExplorer("vcastTutorial");

      const configFile = await workspaceFolderSection.findItem("CCAST_.CFG");
      await configFile.openContextMenu();
      await (await $("aria/Set as VectorCAST Configuration File")).click();
    } else {
      console.log(
        "Skipping set default config file test for tool version > 25"
      );
    }
  });

  it("should enable coded test", async () => {
    await updateTestID();
    if (toolVersion <= 25) {
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
    } else {
      console.log(
        "Skipping set default config file test for tool version > 25"
      );
    }
  });

  it("should check for vmock code completion", async () => {
    await updateTestID();
    if (toolVersion <= 25) {
      console.log("Opening Testing View");
      const vcastTestingViewContent = await getViewContent("Testing");

      let subprogram: TreeItem;
      let testHandle: TreeItem;

      // Iterate over sections to find the "moo" subprogram and expand it
      for (const section of await vcastTestingViewContent.getSections()) {
        subprogram = await findSubprogram("moo", section);
        if (subprogram) {
          // Expand the subprogram if it's not already expanded
          if (!(await subprogram.isExpanded())) await subprogram.expand();
          console.log("Getting test handle");

          testHandle = await getTestHandle(
            subprogram,
            "Coded Tests",
            "mooTests.ExampleTestCase",
            1
          );

          if (testHandle) break;
          throw new Error("Test handle not found for mooTests.ExampleTestCase");
        }
      }

      expect(testHandle).not.toBe(undefined);

      let contextMenu = await testHandle.openContextMenu();
      await contextMenu.select("VectorCAST");

      let menuElement = await $("aria/Edit Coded Test");
      await menuElement.click();

      // Wait until the "tests.cpp" tab is active in the editor view
      const editorView = workbench.getEditorView();
      await browser.waitUntil(
        async () =>
          (await (await editorView.getActiveTab()).getTitle()) === "tests.cpp"
      );

      // Open the "tests.cpp" file in the editor and trigger code completion
      const tab = (await editorView.openEditor("tests.cpp")) as TextEditor;
      await browser.keys([Key.Ctrl, Key.Space]);

      const contentAssist = await tab.toggleContentAssist(true);

      // Just do some autocompletion to see if we can edit the Coded Test
      await tab.setTextAtLine(14, "// vmock");
      let currentLine = await tab.getLineOfText("// vmock");
      await tab.typeTextAt(currentLine, "// vmock".length + 1, " ");
      await tab.save();
      await browser.waitUntil(
        async () => (await contentAssist.getItems()).length > 0
      );

      // Validating content assist for '// vmock'
      const expectedItems = ["moo", "Prototype-Stubs"];

      for (const item of expectedItems) {
        expect(await contentAssist.hasItem(item)).toBe(true);
      }
    } else {
      console.log(
        "Skipping set default config file test for tool version > 25"
      );
    }
  });
});
