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
  findSubprogramMethod,
  openTestScriptFor,
  updateTestID,
  checkIfRequestInLogs,
  editTestScriptFor,
  getGeneratedTooltipTextAt,
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

  it("should edit Test Script and check for autocompletion", async () => {
    await updateTestID();

    console.log("Opening Testing View");
    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded()))
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand();
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          if (!(await subprogram.isExpanded())) await subprogram.expand();
          break;
        }
      }
    }

    if (!subprogram) {
      throw new Error("Subprogram 'manager' not found");
    }

    const subprogramMethod = await findSubprogramMethod(
      subprogram,
      "Manager::PlaceOrder"
    );
    if (!subprogramMethod) {
      throw new Error("Subprogram method 'Manager::PlaceOrder' not found");
    }

    if (!subprogramMethod.isExpanded()) {
      await subprogramMethod.select();
    }

    await openTestScriptFor(subprogramMethod);
    const editorView = workbench.getEditorView();

    const tab = (await editorView.openEditor(
      "vcast-template.tst"
    )) as TextEditor;

    console.log("Check for TEST.SUBPROGRAM:coded_tests_driver autocompletion");
    await browser.keys([Key.Ctrl, Key.Space]);
    const contentAssist = await tab.toggleContentAssist(true);

    let currentLine = await tab.getLineOfText(
      "TEST.SUBPROGRAM:Manager::PlaceOrder"
    );

    await tab.setTextAtLine(currentLine, "TEST.SUBPROGRAM");

    await tab.typeTextAt(currentLine, "TEST.SUBPROGRAM".length + 1, ":");
    await tab.save();

    // Really important to wait until content assist appears
    await browser.waitUntil(
      async () => (await contentAssist.getItems()).length === 10
    );
    expect(await contentAssist.hasItem("coded_tests_driver")).toBe(true);
    await tab.typeTextAt(
      currentLine,
      "TEST.SUBPROGRAM:".length + 1,
      "coded_tests_driver"
    );
    await tab.save();

    //########################################################################################

    console.log(
      "Test for TEST.VALUE & TEST.EXPECTED Hover when TEST.SUBPROGRAM:coded_tests_driver is set"
    );

    currentLine = await tab.getLineOfText("TEST.VALUE");
    let hoverText = await getGeneratedTooltipTextAt(
      currentLine,
      "TEST.VALUE".length - 1,
      tab
    );

    let expectedText = `TEST.VALUE and TEST.EXPECTED are not valid when TEST.SUBPROGRAM is set to coded_tests_driver`;
    expect(hoverText).toContain(expectedText);

    //########################################################################################

    console.log(
      "Test for TEST.CODED_TEST_FILE error hover when TEST.SUBPROGRAM:coded_tests_driver is NOT set"
    );
    currentLine = await tab.getLineOfText("TEST.SUBPROGRAM:coded_tests_driver");
    await tab.setTextAtLine(currentLine, "TEST.SUBPROGRAM:Manager::PlaceOrder");
    currentLine = await tab.getLineOfText("TEST.NEW");
    await tab.moveCursor(currentLine, "TEST.NEW".length + 1);
    await browser.keys([Key.Enter]);
    currentLine += 1;

    await tab.setTextAtLine(currentLine, "TEST.CODED_TEST_FILE");

    hoverText = await getGeneratedTooltipTextAt(
      currentLine,
      "TEST.CODED_TEST_FILE".length - 1,
      tab
    );
    expectedText = `TEST.CODED_TEST_FILE is not valid when TEST.SUBPROGRAM is not set to coded_tests_driver`;
    expect(hoverText).toContain(expectedText);
  });
});
