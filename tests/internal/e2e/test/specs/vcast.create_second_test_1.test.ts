// Test/specs/vcast.test.ts
import {
  type BottomBarPanel,
  type TextEditor,
  type EditorView,
  type Workbench,
  type TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  getGeneratedTooltipTextAt,
  getViewContent,
  findSubprogram,
  findSubprogramMethod,
  editTestScriptFor,
  updateTestID,
} from "../test_utils/vcast_utils";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  const TIMEOUT = 20_000;
  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    editorView = workbench.getEditorView();
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

  it("should edit Test Script and create mySecondTest", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;

    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
        if (subprogram) {
          await subprogram.expand();
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

    await editTestScriptFor(subprogramMethod, "DATABASE-MANAGER");

    const tab = (await editorView.openEditor(
      "DATABASE-MANAGER.tst"
    )) as TextEditor;
    let currentLine = await tab.getLineOfText("TEST.REQUIREMENT_KEY:FR20");
    const requestTooltipText = await getGeneratedTooltipTextAt(
      currentLine,
      "TEST.REQUIREMENT_KEY:FR20".length - 1,
      tab
    );
    console.log(requestTooltipText);
    expect(requestTooltipText).toContain(
      "Clearing a table resets orders for all seats"
    );
    expect(requestTooltipText).toContain(
      "Clearing a table clears the orders for all seats of the table within the table database."
    );

    const findWidget = await tab.openFindWidget();
    await findWidget.setSearchText("TEST.NAME:myFirstTest");
    await findWidget.toggleReplace(true);
    await findWidget.setReplaceText("TEST.NAME:mySecondTest");
    await findWidget.replace();
    await findWidget.close();

    await bottomBar.toggle(false);
    const lastValueLineInPreviousTest =
      "TEST.VALUE:manager.Manager::PlaceOrder.Order.Entree:Steak";
    currentLine = await tab.getLineOfText(lastValueLineInPreviousTest);
    await tab.moveCursor(currentLine, lastValueLineInPreviousTest.length + 1);
    await browser.keys(Key.Enter);
    await tab.save();
    currentLine += 1;
    // Not evaluating LSE, so setting text is sufficent and faster than typing
    await tab.setTextAtLine(
      currentLine,
      "TEST.STUB:database.DataBase::GetTableRecord"
    );
    await tab.moveCursor(
      currentLine,
      "TEST.STUB:database.DataBase::GetTableRecord".length + 1
    );
    await browser.keys(Key.Enter);

    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.STUB:database.DataBase::UpdateTableRecord"
    );

    await tab.save();
    await bottomBar.toggle(true);
    // This produces invalid locator error somehow
    // await tab.openContextMenu()
    // Loading test script directly for now
    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.loadTestScript");
    });
  });
});
