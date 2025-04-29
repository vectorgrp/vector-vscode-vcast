// Test/specs/vcast.test.ts
import {
  EditorView,
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
  getViewContent,
  executeContextMenuAction,
  insertStringToInput,
  checkElementExistsInHTML,
  getNodeText,
  getTexts,
  findTreeNodeAtLevel,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";
import { checkForServerRunnability } from "../../../../unit/getToolversion";
import path from "node:path";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  let useDataServer: boolean = true;
  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    editorView = workbench.getEditorView();
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
    // await browser.waitUntil(async () =>
    //   (await outputView.getChannelNames())
    //     .toString()
    //     .includes("VectorCAST Test Explorer")
    // );
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
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    const initialWorkdir = process.env.INIT_CWD;
    const testInputManage = path.join(
      initialWorkdir,
      "test",
      "manage",
      "free_environments",
      "FREE-BAR.env"
    );
    console.log("Trying to execute: Add existing Environment to Project ");
    await executeContextMenuAction(
      0,
      "Test.vcm",
      true,
      "Add existing Environment to Project"
    );
    console.log("Insert the path to the env file");
    await insertStringToInput(testInputManage, "Environment File Path");

    const button = await $(`aria/OK`);
    await button.click();

    console.log("Checking for Output logs");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            "manage: '-pTest.vcm --level=GNU_Native_Automatic_C++/BlackBox --import"
          ),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText()).toString().includes("Processing project:"),
      { timeout: TIMEOUT }
    );

    console.log("Checking if node is in Tree");
    const envNode = await findTreeNodeAtLevel(3, "FREE-BAR");
    expect(envNode).toBeDefined();
  });

  it("testing creating compiler from CFG file", async () => {
    // Toggle the bottom bar and open the output view.
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    // Define the test file path.
    const initialWorkdir = process.env.INIT_CWD;
    const testInputConfig = path.join(
      initialWorkdir!,
      "test",
      "manage",
      "free_environments",
      "CCAST_.CFG"
    );

    await updateTestID();

    // Execute the context menu action which triggers the command.
    await executeContextMenuAction(
      0,
      "Test.vcm",
      true,
      "Create Compiler from CFG"
    );

    const button3 = await $(`aria/CCAST_.CFG`);
    await button3.click();

    // Wait until the output view reflects that the command returned exit code 0.
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("returned exit code: 0"),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText()).toString().includes("Processing project:"),
      { timeout: TIMEOUT }
    );

    console.log("Checking if Env node is in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(
      1,
      "Compiler_Template_Not_Used"
    );
    expect(testsuiteNode).toBeDefined();
  });

  it("testing deleting compiler from project", async () => {
    // Toggle the bottom bar and open the output view.
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    await updateTestID();

    // Execute the context menu action which triggers the command.
    await executeContextMenuAction(
      1,
      "Compiler_Template_Not_Used",
      true,
      "Delete Compiler"
    );

    // Wait until the output view reflects that the command returned exit code 0.
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("returned exit code: 0"),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText()).toString().includes("Processing project:"),
      { timeout: TIMEOUT }
    );

    console.log("Checking if Env node is in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(
      1,
      "Compiler_Template_Not_Used"
    );
    expect(testsuiteNode).toBeUndefined();
  });

  it("testing Build/Execute Incremental", async () => {
    await updateTestID();
    const initialWorkdir = process.env.INIT_CWD;
    await executeContextMenuAction(
      0,
      "Test.vcm",
      true,
      "Build/Execute Incremental"
    );
    console.log("Checking for Output logs");
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Creating Environment "BAR"`),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Creating Environment "FOO"`),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Creating Environment "QUACK"`),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Report file path is:"),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    console.log("Checking for Report");
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();

    await expect(
      await checkElementExistsInHTML("Manage Incremental Rebuild Report")
    ).toBe(true);
    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });

  it("testing creating a Testsuite", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    await executeContextMenuAction(
      1,
      "GNU_Native_Automatic_C++",
      true,
      "Add Testsuite to Compiler"
    );
    await insertStringToInput("GreyBox", "Testsuite Input");

    const button = await $(`aria/OK`);
    await button.click();

    console.log("Checking for Output logs");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("--testsuite=GreyBox --create --force"),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText()).toString().includes("Processing project:"),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data for:"),
      { timeout: TIMEOUT }
    );

    // Need to wait because there are more than one "Processing environment data for" messages
    await browser.pause(2000);

    console.log("Checking if Testsuite node is in tree");
    const testsuiteNode = await findTreeNodeAtLevel(2, "GreyBox");
    expect(testsuiteNode).toBeDefined();
  });

  it("testing deleting a Testsuite", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    await executeContextMenuAction(2, "GreyBox", true, "Delete Testsuite");
    console.log("Checking for Output logs");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("DELETE TESTSUITE GreyBox"),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText()).toString().includes("Processing project:"),
      { timeout: TIMEOUT }
    );

    console.log("Checking if Testsuite node is not in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(2, "GreyBox");
    expect(testsuiteNode).toBeUndefined();
  });

  it("testing deleting a project Environment", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    await executeContextMenuAction(3, "BAR", true, "Clean Environment");

    const notifications = await $("aria/Notifications");
    await notifications.click();

    const vcastNotificationSourceElement = await $(
      "aria/VectorCAST Test Explorer (Extension)"
    );
    const vcastNotification = await vcastNotificationSourceElement.$("..");
    await (await vcastNotification.$("aria/Clean Environment")).click();

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            `manage: '-pTest.vcm --level=GNU_Native_Automatic_C++/BlackBox/BAR --clean' returned exit code: 0`
          ),
      { timeout: TIMEOUT }
    );

    console.log("Checking if Env node is in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(3, "BAR");
    expect(testsuiteNode).toBeDefined();
  });

  it("testing building a single project environment", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    await executeContextMenuAction(3, "BAR", true, "Build Project Environment");

    console.log("Checking for Output logs");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Creating Environment "BAR"`),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText()).toString().includes(`Processing project:`),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data for:"),
      { timeout: TIMEOUT }
    );

    // Need to wait because there are more than one "Processing environment data for" messages
    await browser.pause(4000);

    console.log("Checking if Env node is in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(3, "BAR");
    expect(testsuiteNode).toBeDefined();
  });

  it("testing remove environment from testsuite", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    await executeContextMenuAction(
      3,
      "FREE-BAR",
      true,
      "Remove Environment from Testsuite"
    );

    console.log("Checking for Output logs");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            `manage: '-pTest.vcm --level=GNU_Native_Automatic_C++/BlackBox --remove FREE-BAR --force' returned exit code: 0`
          ),
      { timeout: TIMEOUT }
    );

    console.log("Checking if Env node is not in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(3, "FREE-ENV");
    expect(testsuiteNode).toBeUndefined();
  });

  it("testing deleting an environment from project", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();
    await executeContextMenuAction(
      3,
      "QUACK",
      true,
      "Delete Environment from Project"
    );

    const notifications = await $("aria/Notifications");
    await notifications.click();
    const vcastNotificationSourceElement = await $(
      "aria/VectorCAST Test Explorer (Extension)"
    );
    const vcastNotification = await vcastNotificationSourceElement.$("..");
    await (await vcastNotification.$("aria/Delete")).click();

    console.log("Checking for Output logs");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            `manage: '-pTest.vcm -eQUACK --delete --force' returned exit code: 0`
          ),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Processing environment data for:`),
      { timeout: TIMEOUT }
    );

    console.log("Checking if Env node is not in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(3, "QUACK");
    expect(testsuiteNode).toBeUndefined();
  });

  it("testing creating an Env from Source Files", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");
    const cppFolder = workspaceFolderSection.findItem("tutorial");
    await (await cppFolder).select();

    console.log("Selecting database.cpp & manager.cpp");
    const managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    const databaseCpp = await workspaceFolderSection.findItem("database.cpp");
    await executeCtrlClickOn(databaseCpp);
    await executeCtrlClickOn(managerCpp);
    await releaseCtrl();

    console.log("Executing: Create VectorCAST Environment in Project");
    await databaseCpp.openContextMenu();
    await (await $("aria/Create VectorCAST Environment in Project")).click();

    // Retrieve all webviews and check the number of webviews open
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1); // Assumes only one webview is open
    const webview = webviews[0];

    // Open the webview
    await webview.open();

    const button = await $(`aria/Import OK`);
    await button.click();

    console.log("Checking for Output logs");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Creating environment 'DATABASE-MANAGER for 2 file(s) ...`),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText()).toString().includes(`Processing project:`),
      { timeout: TIMEOUT }
    );

    console.log("Checking if Env node is not in Tree");
    const TestingView = await activityBar.getViewControl("Testing");
    const testsuiteNode = await findTreeNodeAtLevel(3, "DATABASE-MANAGER");
    expect(testsuiteNode).toBeDefined();

    // Closing all current notifications for the next test
    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();
  });

  it("testing changing project update settings", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    console.log("Changing settings to automatically update project");
    await workbench.getEditorView().closeAllEditors();
    const settingsEditor = await workbench.openSettings();
    await settingsEditor.findSetting(
      "vectorcastTestExplorer.automaticallyUpdateManageProject"
    );
    // Only one setting in search results, so the current way of clicking is correct
    await (await settingsEditor.checkboxSetting$).click();
    await workbench.getEditorView().closeAllEditors();
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
    console.log("Looking for new `Update Project Environment` Button");
    await executeContextMenuAction(
      2,
      "BAR",
      true,
      "Update Project Environment"
    );

    console.log("Pressing on Notification to Clean other Build");
    const notifications = await $("aria/Notifications");
    await notifications.click();
    const vcastNotificationSourceElement = await $(
      "aria/VectorCAST Test Explorer (Extension)"
    );
    const vcastNotification = await vcastNotificationSourceElement.$("..");
    await (await vcastNotification.$("aria/Clean other Environments")).click();

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            `manage: '-pTest.vcm --level=GNU_Native_Automatic_C++/WhiteBox/BAR --clean --force' returned exit code: 0`
          ),
      { timeout: TIMEOUT }
    );

    console.log("Checking for Output logs");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            `manage: '-pTest.vcm --level=GNU_Native_Automatic_C++/BlackBox/BAR --apply-changes --force' returned exit code: 0`
          ),
      { timeout: TIMEOUT }
    );
  });
});
