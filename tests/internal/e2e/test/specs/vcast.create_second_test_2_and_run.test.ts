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
  getViewContent,
  findSubprogram,
  getTestHandle,
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

    let currentLine = await tab.getLineOfText(
      "TEST.STUB:database.DataBase::UpdateTableRecord"
    );
    await tab.moveCursor(
      currentLine,
      "TEST.STUB:database.DataBase::UpdateTableRecord".length + 1
    );
    await browser.keys(Key.Enter);

    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.VALUE:database.DataBase::GetTableRecord.Data[0].CheckTotal:14"
    );

    await tab.moveCursor(
      currentLine,
      "TEST.VALUE:database.DataBase::GetTableRecord.Data[0].CheckTotal:14"
        .length + 1
    );
    await browser.keys(Key.Enter);

    currentLine += 1;
    await tab.setTextAtLine(
      currentLine,
      "TEST.EXPECTED:database.DataBase::UpdateTableRecord.Data[0].CheckTotal:14"
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

  it("should run mySecondTest and check its report", async () => {
    await updateTestID();

    console.log("Looking for Manager::PlaceOrder in the test tree");

    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem;
    let testHandle: TreeItem;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        if (!(await subprogram.isExpanded())) await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "mySecondTest",
          2
        );
        if (testHandle) {
          break;
        } else {
          throw new Error("Test handle not found for mySecondTest");
        }
      }
    }

    if (!subprogram) {
      throw new Error("Subprogram 'manager' not found");
    }

    console.log("Running mySecondTest");

    await testHandle.select();
    await (await (await testHandle.getActionButton("Run Test")).elem).click();
    // It is expected that the VectorCast Report WebView is the only existing WebView at the moment
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();

    await expect($("h4*=Execution Results (FAIL)")).toHaveText(
      "Execution Results (FAIL)"
    );
    await expect($(".event*=Event 1")).toHaveText(
      "Event 1 - Calling Manager::PlaceOrder"
    );

    await expect($(".event*=Event 2")).toHaveText(
      "Event 2 - Stubbed DataBase::GetTableRecord"
    );

    await expect($(".event*=Event 3")).toHaveText(
      "Event 3 - Stubbed DataBase::UpdateTableRecord"
    );

    await expect($(".event*=Event 4")).toHaveText(
      "Event 4 - Returned from Manager::PlaceOrder"
    );

    await expect($(".text-muted*=UUT: manager.cpp")).toHaveText(
      "UUT: manager.cpp"
    );

    await expect($(".text-muted*=UUT: database.cpp")).toHaveText(
      "UUT: database.cpp"
    );

    await expect($(".subprogram*=Manager")).toHaveText("Manager::PlaceOrder");

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);

    console.log("Validating info messages in output channel of the bottom bar");
    await bottomBar.maximize();

    await browser.waitUntil(async () =>
      (await (await bottomBar.openOutputView()).getText()).includes(
        "test explorer  [info]  Starting execution of test: mySecondTest ..."
      )
    );

    const outputViewText = await (await bottomBar.openOutputView()).getText();
    await bottomBar.restore();
    expect(
      outputViewText.includes(
        "test explorer  [info]  Starting execution of test: mySecondTest ..."
      )
    ).toBe(true);
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

    await bottomBar.toggle(true);
    // This produces invalid locator error somehow
    // await tab.openContextMenu()
    // Loading test script directly for now
    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.loadTestScript");
    });
  });
});
