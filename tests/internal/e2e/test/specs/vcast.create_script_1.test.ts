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
  releaseHasEnvironmentVersion,
  contentAssistShowsItem,
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

  it("should create New Test Script for myFirstTest", async () => {
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
    console.log("Getting content assist");
    // Need to activate contentAssist before getting the object
    // That way we avoid a timeout that is a result of
    // toggleContentAssist() implementation
    await browser.keys([Key.Ctrl, Key.Space]);
    const contentAssist = await tab.toggleContentAssist(true);

    const findWidget = await tab.openFindWidget();
    await findWidget.setSearchText("TEST.NAME:test-Manager::PlaceOrder");
    await findWidget.toggleReplace(true);
    await findWidget.setReplaceText("TEST.NAME:myFirstTest");
    await findWidget.replace();
    await browser.keys([Key.Escape]);

    let currentLine = await tab.getLineOfText("TEST.NAME:myFirstTest");
    await tab.moveCursor(currentLine, "TEST.NAME:myFirstTest".length + 1);
    await browser.keys([Key.Enter]);
    currentLine += 1;

    await tab.setTextAtLine(
      currentLine,
      "TEST.REQUIREMENT_KEY:FR20 | Clearing a table resets orders for all seats"
    );

    await tab.moveCursor(
      currentLine,
      "TEST.REQUIREMENT_KEY:FR20 | Clearing a table resets orders for all seats"
        .length + 1
    );
    await browser.keys([Key.Enter]);

    currentLine = await tab.getLineOfText("TEST.VALUE");
    await tab.typeTextAt(currentLine, "TEST.VALUE".length + 1, ":");

    // Really important to wait until content assist appears
    await browser.waitUntil(
      async () => (await contentAssist.getItems()).length === 4
    );

    // Check in server log for autocompletion logs
    if (useDataServer) {
      const expectedLogArray = [
        "received client request: choiceList-tst",
        "line received: 'TEST.VALUE:'",
      ];
      const autocompleteLog = await checkIfRequestInLogs(8, expectedLogArray);
      expect(autocompleteLog).toBe(true);
    }

    console.log("validating content assist (LSE features) for TEST.VALUE:");
    expect(await contentAssist.hasItem("database")).toBe(true);
    expect(await contentAssist.hasItem("manager")).toBe(true);
    expect(await contentAssist.hasItem("USER_GLOBALS_VCAST")).toBe(true);
    expect(await contentAssist.hasItem("uut_prototype_stubs")).toBe(true);

    console.log(
      "validating content assist (LSE features) for TEST.VALUE:manager."
    );
    await tab.typeTextAt(currentLine, "TEST.VALUE:".length + 1, "manager.");

    await browser.waitUntil(
      async () => (await contentAssist.getItems()).length === 8
    );
    expect(await contentAssist.hasItem("<<GLOBAL>>")).toBe(true);
    expect(await contentAssist.hasItem("Manager::AddIncludedDessert")).toBe(
      true
    );
    expect(await contentAssist.hasItem("Manager::AddPartyToWaitingList")).toBe(
      true
    );
    expect(await contentAssist.hasItem("Manager::ClearTable")).toBe(true);
    expect(await contentAssist.hasItem("Manager::GetCheckTotal")).toBe(true);
    expect(await contentAssist.hasItem("Manager::GetNextPartyToBeSeated")).toBe(
      true
    );
    expect(await contentAssist.hasItem("Manager::Manager")).toBe(true);
    expect(await contentAssist.hasItem("Manager::PlaceOrder")).toBe(true);

    await tab.setTextAtLine(currentLine, "");

    // the script is saved by the next test. Saving loads the script into the
    // environment and removes the file, and the language server only offers
    // completions for a script that exists on disk.
  });

  it("should offer the script features of the environment for TEST.SCRIPT_FEATURE:", async () => {
    await updateTestID();

    const editorView = workbench.getEditorView();
    const tab = (await editorView.openEditor(
      "vcast-template.tst"
    )) as TextEditor;

    // Need to activate contentAssist before getting the object
    await browser.keys([Key.Ctrl, Key.Space]);
    const contentAssist = await tab.toggleContentAssist(true);

    // add a new script feature line below an existing one
    const existingFeature = "TEST.SCRIPT_FEATURE:MULTIPLE_UUT_SUPPORT";
    let currentLine = await tab.getLineOfText(existingFeature);
    await tab.moveCursor(currentLine, existingFeature.length + 1);
    await browser.keys([Key.Enter]);
    currentLine += 1;

    try {
      await tab.setTextAtLine(currentLine, "TEST.SCRIPT_FEATURE");
      await tab.typeTextAt(currentLine, "TEST.SCRIPT_FEATURE".length + 1, ":");

      console.log("validating content assist for TEST.SCRIPT_FEATURE:");
      // this one is part of the list that is built into the extension
      await browser.waitUntil(
        async () =>
          await contentAssistShowsItem(contentAssist, "C_DIRECT_ARRAY_INDEXING")
      );

      // all features that are built into the extension have to be offered,
      // no matter which features the VectorCAST release reports
      const builtInFeatures = [
        "ACCEPTING_MISSING_CONST",
        "ADA_DIRECT_ARRAY_INDEXING",
        "C_DIRECT_ARRAY_INDEXING",
        "REMOVED_CL_PREFIX",
        "CPP_CLASS_OBJECT_REVISION",
        "DATA_SPACING_FORMAT",
        "FULL_PARAMETER_TYPES",
        "IGNORE_NAME_VALUE_ERRORS",
        "MIXED_CASE_NAMES",
        "MULTIPLE_UUT_SUPPORT",
        "OVERLOADED_CONST_SUPPORT",
        "STANDARD_SPACING_R2",
        "STRUCT_BASE_CTOR_ADDS_POINTER",
        "STRUCT_DTOR_ADDS_POINTER",
        "STRUCT_FIELD_CTOR_ADDS_POINTER",
        "STATIC_HEADER_FUNCS_IN_UUTS",
        "UNDERSCORE_NULLPTR",
        "VCAST_MAIN_NOT_RENAMED",
      ];
      for (const feature of builtInFeatures) {
        // the list is not empty here, so hasItem() can scroll through it
        expect(await contentAssist.hasItem(feature)).toBe(true);
      }

      // this one is not part of the built-in list, so it is only
      // offered if we got it from the environment
      const newFeature = "USING_DECL_FOR_BASE_MEMBER_HANDLED";
      const releaseHasNewFeature = await releaseHasEnvironmentVersion(
        "REVISION_2025_USING_DECL_FOR_BASE_MEMBER_HANDLED"
      );
      console.log(`release knows ${newFeature}: ${releaseHasNewFeature}`);

      // typing the start of the name filters the list
      await tab.typeTextAt(
        currentLine,
        "TEST.SCRIPT_FEATURE:".length + 1,
        "USING"
      );
      if (releaseHasNewFeature) {
        await browser.waitUntil(
          async () => await contentAssistShowsItem(contentAssist, newFeature)
        );
      } else {
        // give the content assist time to update
        await browser.pause(2000);
        expect(await contentAssistShowsItem(contentAssist, newFeature)).toBe(
          false
        );
      }
    } finally {
      // always restore and save the script, the following specs need it
      await browser.keys([Key.Escape]);
      await tab.setTextAtLine(currentLine, "");
      await tab.save();
    }
  });
});
