// test/specs/vcast.test.ts
import {
  BottomBarPanel,
  StatusBar,
  TextEditor,
  EditorView,
  CustomTreeItem,
  Workbench,
  TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  releaseCtrl,
  executeCtrlClickOn,
  expandWorkspaceFolderSectionInExplorer,
  clickOnButtonInTestingHeader,
  getGeneratedTooltipTextAt,
  getViewContent,
  findSubprogram,
  getTestHandle,
  findSubprogramMethod,
  openTestScriptFor,
  editTestScriptFor,
  deleteTest,
  updateTestID,
  cleanup
} from "../test_utils/vcast_utils";

import { exec, execSync } from "child_process";
import * as path from 'path';
import { promisify } from "node:util";
const promisifiedExec = promisify(exec);
describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  let statusBar: StatusBar;
  const TIMEOUT = 20000;
  before(async () => {
    workbench = await browser.getWorkbench();
    // opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    editorView = workbench.getEditorView();
    process.env["E2E_TEST_ID"] = "0";
  });

  it("test 1: should be able to load VS Code", async () => {
    await updateTestID();
    expect(await workbench.getTitleBar().getTitle()).toBe(
      "[Extension Development Host] vcastTutorial - Visual Studio Code",
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
      { timeout: TIMEOUT },
    );
    console.log("WAITING FOR TEST EXPLORER");
    await browser.waitUntil(async () =>
      (await outputView.getChannelNames())
        .toString()
        .includes("VectorCAST Test Explorer")
    );
    await outputView.selectChannel("VectorCAST Test Explorer")
    console.log("Channel selected")
    console.log("WAITING FOR LANGUAGE SERVER");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Starting the language server"),
      { timeout: TIMEOUT },
    );

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
  });

  it("should validate turning off automatic report generation", async () => {
    await updateTestID();
    console.log("Looking for Manager::PlaceOrder in the test tree");

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const settingsEditor = await workbench.openSettings();
    await settingsEditor.findSetting(
      "vectorcastTestExplorer.showReportOnExecute",
    );
    // only one setting in search results, so the current way of clicking is correct
    await (await settingsEditor.checkboxSetting$).click();
    // The following would have been cleaner but returns un undefined setting object:
    // const setting = await settingsEditor.findSetting("vectorcastTestExplorer.showReportOnExecute");
    // expect(setting).not.toBe(undefined)
    // await setting.setValue(false)

    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "myThirdTest",
          3,
        );
        if (testHandle) {
          break;
        } else {
          throw "Test handle not found for myFirstTest";
        }
      }
    }

    if (!subprogram) {
      throw "Subprogram 'manager' not found";
    }

    console.log("Running myThirdTest");
    await testHandle.select();
    await (await (await testHandle.getActionButton("Run Test")).elem).click();

    await bottomBar.maximize();
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText()).includes(
          "test explorer  [info]  Status: passed",
        ),
      { timeout: TIMEOUT },
    );
    await bottomBar.restore();

    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(0);

    await workbench.openSettings();
    // only one setting in search results, so the current way of clicking is correct
    await (await settingsEditor.checkboxSetting$).click();
  });

  it("should add COMPOUND TEST and validate related LSE features", async () => {
    await updateTestID();

    console.log("Looking for Compound Tests in the test tree");

    console.log("Opening Testing View");
    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem = undefined;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        subprogram = await findSubprogram(
          "Compound Tests",
          vcastTestingViewContentSection,
        );
        if (subprogram) {
          await subprogram.expand();
          break;
        }
      }
    }
    if (!subprogram) {
      throw "Subprogram 'Compound Tests' not found";
    }

    await openTestScriptFor(subprogram as CustomTreeItem);

    const tab = (await editorView.openEditor(
      "vcast-template.tst",
    )) as TextEditor;
    // Need to activate contentAssist before getting the object
    // That way we avoid a timeout that is a result of
    // toggleContentAssist() implementation (if using contentAssist() here)
    // await browser.keys([Key.Ctrl, Key.Space])
    // const contentAssist = await tab.toggleContentAssist(true);

    const findWidget = await tab.openFindWidget();
    await findWidget.setSearchText("TEST.VALUE");
    await findWidget.toggleReplace(true);
    await findWidget.setReplaceText("TEST.SLOT");
    await findWidget.replace();
    await findWidget.close();

    let currentLine = await tab.getLineOfText("TEST.SLOT");

    await tab.setTextAtLine(
      currentLine,
      "TEST.SLOT:1,manager,Manager::PlaceOrder,1,myFirstTest",
    );
    await browser.keys(Key.Enter);
    await tab.save();

    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.SLOT:2,manager,Manager::PlaceOrder,1,mySecondTest",
    );
    await tab.save();

    await browser.keys(Key.Enter);
    await tab.save();
    currentLine += 1;
    await tab.setTextAtLine(currentLine, "TEST.END");
    await tab.save();
    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.loadTestScript");
    });
  });
});
