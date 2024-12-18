// Test/specs/vcast.test.ts
import {
  CustomTreeItem,
  TextEditor,
  type BottomBarPanel,
  type Workbench,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
  getViewContent,
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

  it("should replace coverage kind in env", async () => {
    console.log("Checking value of coverage kind to be 'Statement' ");
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    // In the Settings its Vectorcast Test Explorer --> Build --> Coverage Kind
    // I do not know why the order has to be different here but otherwise I do
    // not get an object and getValue() fails.
    let settingsEditor = await workbench.openSettings();
    const coverageKindSetting = await settingsEditor.findSetting(
      "Coverage Kind",
      "Vectorcast Test Explorer",
      "Build"
    );
    const coverageKindValue = await coverageKindSetting.getValue();
    expect(coverageKindValue).toEqual("Statement");

    console.log("Deleting Env Folder");
    // Right-Click on ENV Folder and delete it

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");
    const cppFolder = await workspaceFolderSection.findItem("cpp");
    await cppFolder.select();
    const unitTestsFolder = await workspaceFolderSection.findItem("unitTests");
    await unitTestsFolder.select();

    const envFolder = await workspaceFolderSection.findItem("DATABASE-MANAGER");
    await envFolder.openContextMenu();
    await (await $("aria/Delete")).click();

    console.log(
      "Change Coverage Kind in DATABASE-MANAGER.env to Statement+MCDC"
    );

    // Open the Editor for the env file and edit the coverage kind by hand
    const envFile = await workspaceFolderSection.findItem(
      "DATABASE-MANAGER.env"
    );
    await envFile.select();
    const editorView = workbench.getEditorView();
    const tab = (await editorView.openEditor(
      "DATABASE-MANAGER.env"
    )) as TextEditor;

    const findWidget = await tab.openFindWidget();
    await findWidget.setSearchText("ENVIRO.COVERAGE_TYPE: Statement");
    await findWidget.toggleReplace(true);
    await findWidget.setReplaceText("ENVIRO.COVERAGE_TYPE: Statement+MCDC");
    await findWidget.replace();
    await browser.keys([Key.Escape]);
    await tab.save();

    console.log("Building Environment directly from DATABASE-MANAGER.env");

    await envFile.openContextMenu();
    await (await $("aria/Build VectorCAST Environment")).click();

    console.log(
      "Check for logs that Setting Up Statement+MC/DC Coverage is shown."
    );

    // The build log should show that the coverage kind is set to Statement+MCDC
    const outputView = await bottomBar.openOutputView();
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Setting Up Statement+MC/DC Coverage"),
      { timeout: TIMEOUT }
    );

    // The VSCode setting on the other hand should still be "Statement"
    settingsEditor = await workbench.openSettings();
    const coverageKindValueAfter = await coverageKindSetting.getValue();
    expect(coverageKindValueAfter).toEqual("Statement");
  });

  it("should rebuild from test explorer  ", async () => {
    const workbench = await browser.getWorkbench();
    const vcastTestingViewContent = await getViewContent("Testing");
    const envName = "cpp/unitTests/DATABASE-MANAGER";

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

    console.log("Check for logs that Setting Up Statement Coverage is shown.");
    // Even though DATABASE-MANAGAER.env has Statement+MCDC, the build log should show only "Statement"
    const outputView = await bottomBar.openOutputView();
    await bottomBar.maximize();
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Setting Up Statement Coverage"),
      { timeout: TIMEOUT }
    );
    await bottomBar.restore();

    console.log("Checking for VSCode Settings");
    // Get the content of the .env file and ensure that the coverage kind there is still "Statement+MCDC"
    const editorView = workbench.getEditorView();
    const tab = (await editorView.openEditor(
      "DATABASE-MANAGER.env"
    )) as TextEditor;
    const fileContent = await tab.getText();
    const lines = fileContent.split("\n");
    expect(lines[2]).toEqual("ENVIRO.COVERAGE_TYPE: Statement+MCDC");
  });
});
