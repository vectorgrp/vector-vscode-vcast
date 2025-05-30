// Test/specs/vcast_coded_tests.test.ts
import {
  type BottomBarPanel,
  type TextEditor,
  type Workbench,
  type TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  expandWorkspaceFolderSectionInExplorer,
  getViewContent,
  findSubprogram,
  getTestHandle,
  updateTestID,
  normalizeContentAssistString,
  getGeneratedTooltipTextAt,
} from "../test_utils/vcast_utils";
import { promisify } from "node:util";
import { exec } from "node:child_process";

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
    await bottomBar.openOutputView();
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
    const envPATHString = process.env.PATH;
    if (envPATHString.includes("2024sp1")) {
      const promisifiedExec = promisify(exec);

      {
        const { stdout, stderr } = await promisifiedExec("env");
        if (stderr) {
          console.log(stderr);
          throw new Error(`Error when running ${"env"}`);
        } else {
          console.log(`${stdout}`);
        }
      }

      // Update test ID for traceability
      await updateTestID();

      // Open the "Testing" view and log the action
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

          // Get the test handle for the specified test case
          testHandle = await getTestHandle(
            subprogram,
            "Coded Tests",
            "mooTests.ExampleTestCase",
            1
          );

          // Break out of the loop if the test handle is found, otherwise throw an error
          if (testHandle) break;
          throw new Error("Test handle not found for mooTests.ExampleTestCase");
        }
      }

      // Ensure the test handle is not undefined
      expect(testHandle).not.toBe(undefined);

      // Open context menu and select "VectorCAST"
      let contextMenu = await testHandle.openContextMenu();
      await contextMenu.select("VectorCAST");

      // Click on "Edit Coded Test" from the menu
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

      // Add a comment "// vmock" on line 14, then add a space and save the file
      await tab.setTextAtLine(14, "// vmock");
      let currentLine = await tab.getLineOfText("// vmock");
      await tab.typeTextAt(currentLine, "// vmock".length + 1, " ");
      await tab.save();

      // Get the tooltip text when hovering over the "// vmock" comment
      const hoverText = await getGeneratedTooltipTextAt(
        currentLine,
        "// vmock".length - 1,
        tab
      );

      // Expected hover text message for environments without mock support
      const expectedText = `This environment does not support mocks, no auto-completion is available. Rebuild the environment to use mocks`;

      // Normalize and verify the hover text matches the expected message
      expect(normalizeContentAssistString(hoverText)).toContain(
        normalizeContentAssistString(expectedText)
      );
    }
  });
});
