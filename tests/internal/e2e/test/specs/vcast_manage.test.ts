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

    console.log("Checking VS Code window title...");
    expect(await workbench.getTitleBar().getTitle()).toBe(
      "[Extension Development Host] vcastTutorial - Visual Studio Code"
    );
  });

  it("should activate vcastAdapter", async () => {
    await updateTestID();

    console.log("Opening Command Palette...");
    await browser.keys([Key.Control, Key.Shift, "p"]);

    console.log("Typing 'vector'...");
    for (const character of "vector") {
      await browser.keys(character);
    }

    console.log("Executing command...");
    await browser.keys(Key.Enter);

    const activityBar = workbench.getActivityBar();
    const viewControls = await activityBar.getViewControls();

    console.log("Available Activity Bar views:");
    for (const viewControl of viewControls) {
      console.log(await viewControl.getTitle());
    }

    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();

    console.log("Waiting for VectorCAST Test Pane Initialization...");
    await $("aria/VectorCAST Test Pane Initialization");

    console.log("Waiting for Testing view to become available...");
    await browser.waitUntil(
      async () => (await activityBar.getViewControl("Testing")) !== undefined,
      { timeout: TIMEOUT }
    );

    await outputView.selectChannel("VectorCAST Test Explorer");
    console.log("Selected 'VectorCAST Test Explorer' channel");

    console.log("Waiting for language server to start...");
    await browser.waitUntil(
      async () =>
        (await outputView.getText()).includes("Starting the language server"),
      { timeout: TIMEOUT }
    );

    console.log("Opening 'Testing' view...");
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
  });

  it("testing tree structure", async () => {
    await updateTestID();

    const nodeTreeLevelList = [
      ["GNU_Native_Automatic_C++"],
      ["BlackBox", "TestSuite", "WhiteBox"],
      ["BAR", "FOO", "QUACK"],
    ];

    const vcastTestingViewContent = await getViewContent("Testing");

    console.log("Waiting for view to fully load...");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const sections = await vcastTestingViewContent.getSections();
    const sectionTitles = await Promise.all(
      sections.map(async (section) => (await section.getTitle()).trim())
    );
    console.log("Available section titles:", sectionTitles);

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

    const explorerChildren = await testExplorerSection.getVisibleItems();
    const explorerChildTexts = await Promise.all(
      explorerChildren.map(async (child) => (await child.elem.getText()).trim())
    );
    console.log("Children of Test Explorer:", explorerChildTexts);

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

    const level0Nodes = await testVcmNode.getChildren();
    const level0Texts = (await getTexts(level0Nodes)).filter(
      (text) => text === "GNU_Native_Automatic_C++"
    );
    console.log("Level 0 texts:", level0Texts);
    expect(level0Texts.sort()).toEqual(nodeTreeLevelList[0].sort());

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

    const level1Nodes = await rootNode.getChildren();
    const level1Texts = await getTexts(level1Nodes);
    console.log("Level 1 texts:", level1Texts);
    expect(level1Texts.sort()).toEqual(nodeTreeLevelList[1].sort());

    for (const node of level1Nodes) {
      const label = await getNodeText(node);

      if (label === "Testsuite") {
        const children = await node.getChildren();
        expect(children.length).toBe(0);
      } else if (label === "BlackBox" || label === "WhiteBox") {
        if (!(await node.isExpanded())) {
          await node.expand();
        }

        const children = await node.getChildren();
        const childTexts = await getTexts(children);
        console.log(`Children under ${label}:`, childTexts);
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
      initialWorkdir!,
      "test",
      "manage",
      "free_environments",
      "FREE-BAR.env"
    );

    console.log(
      "Executing context menu action: Add existing Environment to Project..."
    );
    await executeContextMenuAction(
      0,
      "Test.vcm",
      true,
      "Add existing Environment to Project"
    );

    console.log("Inserting path to env file...");
    await insertStringToInput(testInputManage, "envFileInput");

    const button = await $(`aria/OK`);
    await button.click();

    console.log("Waiting for command output logs...");
    await browser.waitUntil(
      async () =>
        (await outputView.getText()).includes(
          "manage: '-pTest.vcm --level=GNU_Native_Automatic_C++/BlackBox --import"
        ),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () => (await outputView.getText()).includes("Processing project:"),
      { timeout: TIMEOUT }
    );

    console.log("Verifying FREE-BAR node exists in the test tree...");
    const envNode = await findTreeNodeAtLevel(3, "FREE-BAR");
    expect(envNode).toBeDefined();
  });

  it("testing creating compiler from CFG file", async () => {
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    const initialWorkdir = process.env.INIT_CWD;
    const testInputConfig = path.join(
      initialWorkdir!,
      "test",
      "manage",
      "free_environments",
      "CCAST_.CFG"
    );

    await updateTestID();

    // Run command: Create Compiler from CFG
    console.log("Executing: Create Compiler from CFG");
    await executeContextMenuAction(
      0,
      "Test.vcm",
      true,
      "Create Compiler from CFG"
    );

    const button3 = await $(`aria/CCAST_.CFG`);
    await button3.click();

    // Wait for success output
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

    console.log("Verifying that compiler node is in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(
      1,
      "Compiler_Template_Not_Used"
    );
    expect(testsuiteNode).toBeDefined();
  });

  it("testing deleting compiler from project", async () => {
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    await updateTestID();

    console.log("Executing: Delete Compiler");
    await executeContextMenuAction(
      1,
      "Compiler_Template_Not_Used",
      true,
      "Delete Compiler"
    );

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

    console.log("Verifying compiler node is deleted from Tree");
    const testsuiteNode = await findTreeNodeAtLevel(
      1,
      "Compiler_Template_Not_Used"
    );
    expect(testsuiteNode).toBeUndefined();
  });

  it("testing Build/Execute Incremental", async () => {
    await updateTestID();
    const initialWorkdir = process.env.INIT_CWD;

    console.log("Executing: Build/Execute Incremental");
    await executeContextMenuAction(
      0,
      "Test.vcm",
      true,
      "Build/Execute Incremental"
    );

    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();

    console.log("Waiting for environments to be created in output log");
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

    console.log("Opening Report Webview");
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];
    await webview.open();

    console.log("Validating Report Content");
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

    console.log("Executing: Add Testsuite to Compiler");
    await executeContextMenuAction(
      1,
      "GNU_Native_Automatic_C++",
      true,
      "Add Testsuite to Compiler"
    );

    console.log("Inserting Testsuite name: GreyBox");
    await insertStringToInput("GreyBox", "testSuiteInput");

    const button = await $(`aria/OK`);
    await button.click();

    console.log("Waiting for Testsuite creation log");
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

    await browser.pause(2000); // Ensure all logs have flushed

    console.log("Verifying GreyBox node exists in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(2, "GreyBox");
    expect(testsuiteNode).toBeDefined();
  });

  it("testing deleting a Testsuite", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    console.log("Executing: Delete Testsuite");
    await executeContextMenuAction(2, "GreyBox", true, "Delete Testsuite");

    console.log("Waiting for deletion log");
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

    console.log("Verifying GreyBox node is removed from Tree");
    const testsuiteNode = await findTreeNodeAtLevel(2, "GreyBox");
    expect(testsuiteNode).toBeUndefined();
  });

  it("testing deleting a project Environment", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    console.log("Executing: Clean Environment");
    await executeContextMenuAction(3, "BAR", true, "Clean Environment");

    console.log("Triggering VSCode Clean confirmation");
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

    console.log("Checking that BAR environment still exists in tree");
    const testsuiteNode = await findTreeNodeAtLevel(3, "BAR");
    expect(testsuiteNode).toBeDefined();
  });

  it("testing building a single project environment", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    console.log("Executing: Build Project Environment for BAR");
    await executeContextMenuAction(3, "BAR", true, "Build Project Environment");

    console.log("Waiting for environment creation log");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Creating Environment "BAR"`),
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

    await browser.pause(4000); // Allow additional environment logs to appear

    console.log("Verifying BAR environment node is in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(3, "BAR");
    expect(testsuiteNode).toBeDefined();
  });

  it("testing remove environment from testsuite", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    console.log("Executing: Remove Environment from Testsuite (FREE-BAR)");
    await executeContextMenuAction(
      3,
      "FREE-BAR",
      true,
      "Remove Environment from Testsuite"
    );

    console.log("Waiting for removal confirmation log");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            `manage: '-pTest.vcm --level=GNU_Native_Automatic_C++/BlackBox --remove FREE-BAR --force' returned exit code: 0`
          ),
      { timeout: TIMEOUT }
    );

    console.log("Verifying FREE-ENV node is no longer in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(3, "FREE-ENV");
    expect(testsuiteNode).toBeUndefined();
  });

  it("testing creating an Env from Source Files", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    console.log("Opening Explorer to select source files");
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");
    const cppFolder = workspaceFolderSection.findItem("tutorial");
    await (await cppFolder).select();

    console.log(
      "Selecting database.cpp and manager.cpp for environment creation"
    );
    const managerCpp = await workspaceFolderSection.findItem("manager.cpp");
    const databaseCpp = await workspaceFolderSection.findItem("database.cpp");
    await executeCtrlClickOn(databaseCpp);
    await executeCtrlClickOn(managerCpp);
    await releaseCtrl();

    console.log("Triggering environment creation from context menu");
    await databaseCpp.openContextMenu();
    await (await $("aria/Create VectorCAST Environment in Project")).click();

    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];
    await webview.open();

    console.log("Confirming import in webview");
    const button = await $(`aria/importOk`);
    await button.click();

    console.log("Waiting for environment creation logs");
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

    console.log("Verifying DATABASE-MANAGER environment node is in Tree");
    const TestingView = await activityBar.getViewControl("Testing");
    const testsuiteNode = await findTreeNodeAtLevel(3, "DATABASE-MANAGER");
    expect(testsuiteNode).toBeDefined();

    console.log("Clearing notifications for next test");
    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();
  });

  it("testing changing project update settings", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    console.log("Navigating to Explorer view");
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    console.log("Updating project auto-update setting");
    await workbench.getEditorView().closeAllEditors();
    const settingsEditor = await workbench.openSettings();
    await settingsEditor.findSetting(
      "vectorcastTestExplorer.automaticallyUpdateManageProject"
    );
    await (await settingsEditor.checkboxSetting$).click(); // Toggle setting

    await workbench.getEditorView().closeAllEditors();

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();

    console.log("Running 'Update Project Environment' on BAR");
    await executeContextMenuAction(
      2,
      "BAR",
      true,
      "Update Project Environment"
    );

    console.log("Handling clean build notification");
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
            `manage: '-pTest.vcm --level=GNU_Native_Automatic_C++/WhiteBox/BAR --clean' returned exit code: 0`
          ),
      { timeout: TIMEOUT }
    );

    console.log("Waiting for final update confirmation");
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
