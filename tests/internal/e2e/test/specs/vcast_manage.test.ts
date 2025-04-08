// Test/specs/vcast.test.ts
import {
  TreeItem,
  type BottomBarPanel,
  type Workbench,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  releaseCtrl,
  executeCtrlClickOn,
  expandWorkspaceFolderSectionInExplorer,
  updateTestID,
  checkIfRequestInLogs,
  getViewContent,
  executeContextMenuAction,
  insertStringToInput,
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

  it("testing tree structure", async () => {
    await updateTestID();

    // Expected tree structure relative to the "Test.vcm" container:
    // Level 0: Under Test.vcm, expect "GNU_Native_Automatic_C++"
    // Level 1: Under GNU_Native_Automatic_C++, expect "BlackBox", "Testsuite", "WhiteBox"
    // Level 2: For "BlackBox" and "WhiteBox", expect children: "BAR", "FOO", "QUACK"
    const nodeTreeLevelList = [
      ["GNU_Native_Automatic_C++"],
      ["BlackBox", "TestSuite", "WhiteBox"],
      ["BAR", "FOO", "QUACK"],
    ];

    const vcastTestingViewContent = await getViewContent("Testing");

    // Wait briefly to allow the view to load.
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const sections = await vcastTestingViewContent.getSections();
    // Log available section titles for debugging.
    const sectionTitles = await Promise.all(
      sections.map(async (section) => (await section.getTitle()).trim())
    );
    console.log("Available section titles:", sectionTitles);

    // The only section is "Test Explorer"
    const testExplorerSection = sections.find(async (section) => {
      return (await section.getTitle()).trim() === "Test Explorer";
    });
    if (!testExplorerSection) {
      throw new Error(
        "Test Explorer section not found. Available sections: " +
          sectionTitles.join(", ")
      );
    }
    if (!(await testExplorerSection.isExpanded())) {
      await testExplorerSection.expand();
    }

    // Get the children of Test Explorer using getVisibleItems().
    const explorerChildren = await testExplorerSection.getVisibleItems();
    // Log their texts for debugging.
    const explorerChildTexts = await Promise.all(
      explorerChildren.map(async (child) => (await child.elem.getText()).trim())
    );
    console.log("Children of Test Explorer:", explorerChildTexts);

    // Find the "Test.vcm" node.
    let testVcmNode: any = undefined;
    for (const child of explorerChildren) {
      const text = (await child.elem.getText()).trim();
      if (text === "Test.vcm") {
        testVcmNode = child;
        break;
      }
    }
    if (!testVcmNode) {
      throw new Error(
        "Test.vcm node not found within Test Explorer. Found: " +
          explorerChildTexts.join(", ")
      );
    }
    if (!(await testVcmNode.isExpanded())) {
      await testVcmNode.expand();
    }

    // Helper: retrieve node text (from CustomTreeItem or ViewSection).
    async function getNodeText(node: any): Promise<string> {
      if (
        "elem" in node &&
        node.elem &&
        typeof node.elem.getText === "function"
      ) {
        return (await node.elem.getText()).trim();
      }
      if (typeof node.getTitle === "function") {
        return (await node.getTitle()).trim();
      }
      throw new Error("Unknown node type");
    }

    // Helper: retrieve texts from an array of nodes.
    async function getTexts(nodes: any[]): Promise<string[]> {
      const texts: string[] = [];
      for (const node of nodes) {
        texts.push(await getNodeText(node));
      }
      return texts;
    }

    // Level 0: Under Test.vcm, we expect one node: "GNU_Native_Automatic_C++"
    const level0Nodes = await testVcmNode.getChildren();
    const level0Texts = (await getTexts(level0Nodes)).filter(
      (text) => text === "GNU_Native_Automatic_C++"
    );
    console.log("Level 0 texts:", level0Texts);
    expect(level0Texts.sort()).toEqual(nodeTreeLevelList[0].sort());

    // Find the "GNU_Native_Automatic_C++" node.
    let rootNode: any = undefined;
    for (const node of level0Nodes) {
      if ((await getNodeText(node)) === "GNU_Native_Automatic_C++") {
        rootNode = node;
        break;
      }
    }
    if (!rootNode) {
      throw new Error("GNU_Native_Automatic_C++ node not found under Test.vcm");
    }
    if (!(await rootNode.isExpanded())) {
      await rootNode.expand();
    }

    // Level 1: Direct children of GNU_Native_Automatic_C++.
    const level1Nodes = await rootNode.getChildren();
    const level1Texts = await getTexts(level1Nodes);
    console.log("Level 1 texts:", level1Texts);
    expect(level1Texts.sort()).toEqual(nodeTreeLevelList[1].sort());

    // Level 2: Check each level1 node individually.
    for (const node of level1Nodes) {
      const label = await getNodeText(node);
      if (label === "Testsuite") {
        // For "Testsuite", we do not expect any children.
        const children = await node.getChildren();
        expect(children.length).toBe(0);
      } else if (label === "BlackBox" || label === "WhiteBox") {
        if (!(await node.isExpanded())) {
          await node.expand();
        }
        const children = await node.getChildren();
        const childTexts = await getTexts(children);
        console.log(`Children under ${label}:`, childTexts);
        // Expect exactly ["BAR", "FOO", "QUACK"] (order does not matter)
        expect(childTexts.sort()).toEqual(nodeTreeLevelList[2].sort());
      }
    }
  });

  it("testing adding an existing env on the project node", async () => {
    await updateTestID();
    await executeContextMenuAction(
      0,
      "Test.vcm",
      true,
      "Add existing Environment to Project"
    );
    await insertStringToInput(
      "path/to/ligma",
      "envFileInput",
      "Add Environment To Project"
    );
  });
});
