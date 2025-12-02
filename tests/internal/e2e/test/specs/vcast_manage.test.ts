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
  TIMEOUT,
  waitForEnvSuffix,
  insertStringIntoAutocompletionInput,
} from "../test_utils/vcast_utils";
import path from "node:path";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    editorView = workbench.getEditorView();
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

  it("testing creating new compiler", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();

    console.log("Create new Compiler in Project");
    await executeContextMenuAction(
      0,
      "Test.vcm",
      true,
      "Create new Compiler in Project"
    );

    console.log("Inserting Data to Webview");
    await insertStringIntoAutocompletionInput(
      "GNU Native_Automatic_C",
      "Compiler Name Input",
      true
    );
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Added Compiler CCAST_.CFG to Project Test`),
      { timeout: TIMEOUT }
    );

    console.log("Checking for existence of new Compiler");
    const compilerNode = await findTreeNodeAtLevel(
      1,
      "GNU_Native_Automatic_C_1"
    );
    expect(compilerNode).toBeDefined();
  });

  it("testing creating new project", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();

    console.log("Executing Create New Project Command:");
    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.createNewProject");
    });

    console.log("Inserting Data to Webview");
    // For the compiler tab we need to do it that way, because it's input is not found
    // The different strucutre (autocompletion) + we already clicked on the same webview
    // make the problems, so we just navigate with tab and enter within the webview
    await insertStringToInput("ANewProject", "Project Name Input");
    await browser.keys(["Tab"]);
    await browser.keys("GNU Native_Automatic_C++17");
    await browser.keys(["Tab"]);
    await browser.keys(["Tab"]);
    await browser.keys(["Tab"]);
    await browser.keys(["Tab"]);
    await browser.keys(["Enter"]);

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`-lc option VCAST_CODED_TESTS_SUPPORT FALSE`),
      { timeout: TIMEOUT }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Processing project: ANewProject`),
      { timeout: TIMEOUT }
    );

    console.log("Checking existence of new Project");
    const projectNode = await findTreeNodeAtLevel(0, "ANewProject.vcm");
    const compilerNode = await findTreeNodeAtLevel(
      1,
      "GNU_Native_Automatic_C++17"
    );
    expect(projectNode).toBeDefined();
    expect(compilerNode).toBeDefined();
  });

  it("testing tree structure", async () => {
    await updateTestID();

    // Expected tree structure relative to the "Test.vcm" container:
    // Level 0: Under Test.vcm, expect "GNU_Native_Automatic_C++"
    // Level 1: Under GNU_Native_Automatic_C++, expect "BlackBox", "TestSuite", "WhiteBox"
    // Level 2: For "BlackBox" and "WhiteBox", expect children: "BAR", "FOO", "QUACK"
    const nodeTreeLevelList = [
      ["GNU_Native_Automatic_C++"],
      ["BlackBox", "TestSuite", "WhiteBox"],
      ["BAR", "FOO", "QUACK"],
    ];

    const vcastTestingViewContent = await getViewContent("Testing");

    const sections = await vcastTestingViewContent.getSections();
    // Log available section titles for debugging.
    const sectionTitles = await Promise.all(
      sections.map(async (section) => (await section.getTitle()).trim())
    );
    console.log("Available section titles:", sectionTitles);

    // The only section is "Test Explorer"
    const testExplorerSection = sections.find(
      async (section) => (await section.getTitle()).trim() === "Test Explorer"
    );
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
    let testVcmNode: any;
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

    // Sort the actual and expected arrays using localeCompare (sonar wants it that way)
    const sortedLevel0 = level0Texts.sort((a, b) => a.localeCompare(b));
    const expectedLevel0 = [...nodeTreeLevelList[0]].sort((a, b) =>
      a.localeCompare(b)
    );
    expect(sortedLevel0).toEqual(expectedLevel0);

    // Find the "GNU_Native_Automatic_C++" node.
    let rootNode: any;
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

    const sortedLevel1 = level1Texts.sort((a, b) => a.localeCompare(b));
    const expectedLevel1 = [...nodeTreeLevelList[1]].sort((a, b) =>
      a.localeCompare(b)
    );
    expect(sortedLevel1).toEqual(expectedLevel1);

    // Level 2: Check each level1 node individually.
    for (const node of level1Nodes) {
      const label = await getNodeText(node);
      if (label === "TestSuite") {
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

        const sortedChildren = childTexts.sort((a, b) => a.localeCompare(b));
        const expectedChildren = [...nodeTreeLevelList[2]].sort((a, b) =>
          a.localeCompare(b)
        );
        expect(sortedChildren).toEqual(expectedChildren);
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
    console.log(
      "Trying to execute: Add existing Environment FREE-BAR.env to Project "
    );
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

    console.log("Checking if node FREE-BAR is in Tree");
    const envNode = await findTreeNodeAtLevel(3, "FREE-BAR");
    expect(envNode).toBeDefined();
  });

  it("testing creating compiler from CFG file", async () => {
    // Toggle the bottom bar and open the output view.
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    await updateTestID();

    // Execute the context menu action which triggers the command.
    await executeContextMenuAction(
      0,
      "Test.vcm",
      true,
      "Create Compiler from CFG"
    );

    // Search for the file and click on it
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

    console.log(
      "Checking if Compiler node Compiler_Template_Not_Used is in Tree"
    );
    // Compiler node name is weird, but is a normal compiler
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

    console.log(
      "Checking if Compiler node Compiler_Template_Not_Used is not in Tree"
    );
    const testsuiteNode = await findTreeNodeAtLevel(
      1,
      "Compiler_Template_Not_Used"
    );
    expect(testsuiteNode).toBeUndefined();
  });

  it("testing Build/Execute Incremental", async () => {
    await updateTestID();
    // Build Execute Incremental
    await executeContextMenuAction(
      0,
      "Test.vcm",
      true,
      "Build/Execute Incremental"
    );
    console.log("Checking for Output logs after Build/Execute Incremental");
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

    console.log("Checking for Build/Execute Incremental Report");
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];
    await webview.open();
    await expect(
      await checkElementExistsInHTML("Manage Incremental Rebuild Report")
    ).toBe(true);

    // CLose Report again
    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });

  it("testing creating a Testsuite", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    console.log("Adding Testsuite GreyBox to Compiler");
    await executeContextMenuAction(
      1,
      "GNU_Native_Automatic_C++",
      true,
      "Add Testsuite to Compiler"
    );
    await insertStringToInput("GreyBox", "Testsuite Input");
    const button = await $(`aria/OK`);
    await button.click();

    console.log("Checking for Output logs if Testsuite creation is finished");
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

    await waitForEnvSuffix(outputView, "FOO");
    await waitForEnvSuffix(outputView, "BAR");
    await waitForEnvSuffix(outputView, "QUACK");

    // Need to wait because there are more than one "Processing environment data for" messages
    await browser.pause(2000);

    console.log("Checking if Testsuite node GreyBox is in tree");
    const testsuiteNode = await findTreeNodeAtLevel(2, "GreyBox");
    expect(testsuiteNode).toBeDefined();
  });

  it("testing deleting a Testsuite", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    await executeContextMenuAction(2, "GreyBox", true, "Delete Testsuite");

    console.log("Checking for Output logs if Testsuite deletion is finished");
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

    await browser.waitUntil(
      async () => {
        const testsuiteNode = await findTreeNodeAtLevel(2, "GreyBox");
        return testsuiteNode === undefined;
      },
      {
        timeout: TIMEOUT,
        interval: 500,
        timeoutMsg:
          'Expected Testsuite node "GreyBox" to be removed from the tree within timeout',
      }
    );

    console.log("Checking if Testsuite node GreyBox is not in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(2, "GreyBox");
    expect(testsuiteNode).toBeUndefined();
  });

  it("testing cleaning a project Environment", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    console.log("Cleaning Environment BAR");
    await executeContextMenuAction(3, "BAR", true, "Clean Environment");

    console.log("Confirming Notifications to clean the Environment");
    const notifications = await $("aria/Notifications");
    await notifications.click();
    const vcastNotificationSourceElement = await $(
      "aria/VectorCAST Test Explorer (Extension)"
    );
    const vcastNotification = await vcastNotificationSourceElement.$("..");
    await (await vcastNotification.$("aria/Clean Environment")).click();

    console.log("Checking for Output logs if Environment clean is finished");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            `manage: '-pTest.vcm --level=GNU_Native_Automatic_C++/BlackBox/BAR --clean --force' returned exit code: 0`
          ),
      { timeout: TIMEOUT }
    );

    console.log("Checking if Env node BAR is still in the Tree");
    await browser.waitUntil(
      async () => {
        const testsuiteNode = await findTreeNodeAtLevel(3, "BAR");
        return testsuiteNode !== undefined;
      },
      {
        timeout: TIMEOUT,
        interval: 500,
        timeoutMsg: 'Expected Env node "BAR" to be in the tree within timeout',
      }
    );
    const testsuiteNode = await findTreeNodeAtLevel(3, "BAR");
    expect(testsuiteNode).toBeDefined();
  });

  it("testing building a single project environment", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    await executeContextMenuAction(3, "BAR", true, "Build Project Environment");

    console.log("Checking for Output logs if Environment build is finished");
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
    await browser.waitUntil(
      async () => {
        const testsuiteNode = await findTreeNodeAtLevel(3, "BAR");
        return testsuiteNode !== undefined;
      },
      {
        timeout: TIMEOUT,
        interval: 500,
        timeoutMsg: 'Expected Env node "BAR" to be in the tree within timeout',
      }
    );

    console.log("Checking if Env node is in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(3, "BAR");
    expect(testsuiteNode).toBeDefined();
  });

  it("testing remove environment from testsuite", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    console.log("Removing Environment FREE-BAR from Testsuite");
    await executeContextMenuAction(
      3,
      "FREE-BAR",
      true,
      "Remove Environment from Testsuite"
    );

    console.log("Checking for Output logs if Environment removal is finished");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(
            `manage: '-pTest.vcm --level=GNU_Native_Automatic_C++/BlackBox --remove FREE-BAR --force' returned exit code: 0`
          ),
      { timeout: TIMEOUT }
    );

    console.log("Checking if Env node FREE-BAR is not in Tree");

    // Poll every 500 ms for up to 5 seconds
    await browser.waitUntil(
      async () => {
        const node: TreeItem | undefined = await findTreeNodeAtLevel(
          3,
          "FREE-BAR"
        );
        return node === undefined;
      },
      {
        timeout: 5_000,
        interval: 500,
        timeoutMsg:
          'Expected Env node "FREE-BAR" to be removed from the tree within 5s',
      }
    );
    const testsuiteNode = await findTreeNodeAtLevel(3, "FREE-BAR");
    expect(testsuiteNode).toBeUndefined();
  });

  it("testing deleting an environment from project", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();

    // Trigger the Delete action
    await executeContextMenuAction(
      3,
      "QUACK",
      true,
      "Delete Environment from Project"
    );
    await browser.takeScreenshot();
    await browser.saveScreenshot("info_clicked_on_delete.png");

    console.log("Confirming Notifications to delete the Environment");

    // Wait for the notification to be generated (exist in DOM)
    const vcastNotificationSelector =
      "aria/VectorCAST Test Explorer (Extension)";
    const pendingNotification = await $(vcastNotificationSelector);
    await pendingNotification.waitForExist({
      timeout: TIMEOUT,
      timeoutMsg: "Timeout waiting for VectorCAST notification to be generated",
    });

    // Open the Notification Center
    const notifications = await $("aria/Notifications");
    await notifications.waitForClickable({ timeout: TIMEOUT });
    await notifications.click();

    // Re-select the element now that the Center is open
    const vcastNotificationSourceElement = await $(vcastNotificationSelector);

    // Wait for it to be VISIBLE (handles the sliding animation of the panel)
    await vcastNotificationSourceElement.waitForDisplayed({
      timeout: TIMEOUT,
      timeoutMsg:
        "VectorCAST notification entry did not become visible in the center",
    });

    // Navigate to the Delete button
    const vcastNotification = await vcastNotificationSourceElement.$("..");
    const deleteAction = await vcastNotification.$("aria/Delete");

    // Wait for the button to be Clickable (handles animation/obscuring)
    await deleteAction.waitForClickable({
      timeout: TIMEOUT,
      timeoutMsg: "Delete button in notification was not interactable",
    });

    await deleteAction.click();

    console.log("Checking for Output logs if Environment deletion is finished");
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

    console.log("Checking if Env node QUACK is not in Tree");
    await browser.waitUntil(
      async () => {
        const testsuiteNode = await findTreeNodeAtLevel(3, "QUACK");
        return testsuiteNode === undefined;
      },
      {
        timeout: TIMEOUT,
        interval: 500,
        timeoutMsg:
          'Expected Env node "QUACK" to be not in the tree within timeout',
      }
    );
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
    console.log("Checking for Output logs if Environment creation is finished");
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

    console.log("Checking if Env node DATABASE-MANAGER is in Tree");

    await activityBar.getViewControl("Testing");
    await browser.waitUntil(
      async () => {
        const testsuiteNode = await findTreeNodeAtLevel(3, "DATABASE-MANAGER");
        return testsuiteNode !== undefined;
      },
      {
        timeout: TIMEOUT,
        interval: 500,
        timeoutMsg:
          'Expected Env node "DATABASE-MANAGER" to be in the tree within timeout',
      }
    );
    const testsuiteNode = await findTreeNodeAtLevel(3, "DATABASE-MANAGER");
    expect(testsuiteNode).toBeDefined();

    // Closing all current notifications for the next test
    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();
  });

  it("testing building new added project environment", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    await executeContextMenuAction(
      3,
      "DATABASE-MANAGER",
      true,
      "Build Project Environment"
    );

    console.log("Checking for Output logs if Environment build is finished");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Creating Environment "DATABASE-MANAGER"`),
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
    await browser.waitUntil(
      async () => {
        const testsuiteNode = await findTreeNodeAtLevel(3, "DATABASE-MANAGER");
        return testsuiteNode !== undefined;
      },
      {
        timeout: TIMEOUT,
        interval: 500,
        timeoutMsg:
          'Expected Env node "DATABASE-MANAGER" to be in the tree within timeout',
      }
    );

    console.log("Checking if Env node is in Tree");
    const testsuiteNode = await findTreeNodeAtLevel(3, "DATABASE-MANAGER");
    expect(testsuiteNode).toBeDefined();
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

    console.log("Checking for Output logs if Environment update is finished");
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
