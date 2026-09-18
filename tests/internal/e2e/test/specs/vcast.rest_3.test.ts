// Test/specs/vcast.test.ts
import { exec } from "node:child_process";
import * as fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  type BottomBarPanel,
  type StatusBar,
  type TextEditor,
  type EditorView,
  type CustomTreeItem,
  type Workbench,
  type TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  expandWorkspaceFolderSectionInExplorer,
  getViewContent,
  findSubprogram,
  getTestHandle,
  deleteTest,
  updateTestID,
  assertTestsDeleted,
  rebuildEnvironmentFromTestingPane,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";

const promisifiedExec = promisify(exec);
describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  let statusBar: StatusBar;
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

  it("Verifies that gutter decorations dissapear when we edit manager.cpp", async () => {
    await updateTestID();

    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    const explorerSideBarView = await explorerView?.openView();

    const workspaceFolderName = "vcastTutorial";
    const workspaceFolderSection = await explorerSideBarView
      .getContent()
      .getSection(workspaceFolderName.toUpperCase());
    console.log(await workspaceFolderSection.getTitle());
    await workspaceFolderSection.expand();

    const cppFolder = workspaceFolderSection.findItem("cpp");
    await (await cppFolder).select();

    const managerCpp = workspaceFolderSection.findItem("manager.cpp");
    await (await managerCpp).select();

    editorView = workbench.getEditorView();
    const tab = (await editorView.openEditor("manager.cpp")) as TextEditor;
    // Moving cursor to make sure coverage indicators are in view
    await tab.moveCursor(10, 23);
    console.log("Editing manager.cpp to trigger removing coverage decorators");
    await browser.keys(Key.Enter);
    await tab.save();
    console.log(
      "Verifying that the coverage decorators got removed after file edit"
    );

    statusBar = workbench.getStatusBar();
    // Need to wait until status bar updates for gutters to actually disappear
    await browser.waitUntil(async () =>
      (await statusBar.getItems()).includes("Coverage Out of Date")
    );

    const lineNumberElement = await $(".line-numbers=10");
    const coverageDecoElementHTML = await (
      await lineNumberElement.parentElement()
    ).getHTML();
    expect(coverageDecoElementHTML.includes("codicon")).toBe(false);
    expect(coverageDecoElementHTML.includes("TextEditorDecorationType")).toBe(
      false
    );
  });

  it("should verify coverage info in the Status Bar is Coverage Out of Date", async () => {
    await updateTestID();

    statusBar = workbench.getStatusBar();
    const statusBarInfos = await statusBar.getItems();
    expect(statusBarInfos.includes("Coverage Out of Date")).toBe(true);
  });

  // The incremental re-build only recompiles the harness, it does not re-parse
  // the units. clicast therefore refuses changes that would alter the
  // parameter tree (here a renamed parameter), keeps the previous harness and
  // the extension has to offer the full re-build instead.
  it("should refuse an incremental re-build after an interface change and offer the full re-build", async () => {
    await updateTestID();
    const envName = "DATABASE-MANAGER";

    editManagerCpp(ORIGINAL_CLEAR_TABLE, RENAMED_CLEAR_TABLE);
    try {
      const outputView = await bottomBar.openOutputView();
      await outputView.clearText();
      await rebuildEnvironmentFromTestingPane(
        envName,
        "Incremental Re-Build Environment"
      );

      console.log("Waiting for clicast to refuse the incremental re-build");
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes(
              "Incremental Rebuild failed due to a global scope change"
            ),
        { timeout: TIMEOUT }
      );
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes(`Environment incremental re-build failed for ${envName}`),
        { timeout: TIMEOUT }
      );

      console.log("Checking the notification that offers the full re-build");
      const notification = await waitForNotification(
        `The incremental re-build of ${envName} failed`
      );
      const actionTitles: string[] = [];
      for (const action of await notification.getActions()) {
        actionTitles.push(await action.getTitle());
      }
      expect(actionTitles).toContain("Re-Build Environment");

      // Closing the notification must not start the full re-build
      await notification.dismiss();
      await browser.pause(2000);
      const outputText = (await outputView.getText()).toString();
      expect(outputText).not.toContain("Environment re-build complete");
      expect(outputText).not.toContain("Environment built Successfully");
    } finally {
      editManagerCpp(RENAMED_CLEAR_TABLE, ORIGINAL_CLEAR_TABLE);
    }
  });

  it("should incrementally re-build the environment after a function body change", async () => {
    await updateTestID();
    const envName = "DATABASE-MANAGER";

    editManagerCpp(ORIGINAL_DELETE_RECORD, EXTENDED_DELETE_RECORD);
    try {
      const outputView = await bottomBar.openOutputView();
      await outputView.clearText();
      await rebuildEnvironmentFromTestingPane(
        envName,
        "Incremental Re-Build Environment"
      );

      console.log("Waiting for the incremental re-build to complete");
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes(
              `Environment incremental re-build complete for ${envName}`
            ),
        { timeout: TIMEOUT }
      );
      const outputText = (await outputView.getText()).toString();
      expect(outputText).toContain("Incremental Rebuild Complete");
      expect(outputText).not.toContain("Incremental Rebuild failed");

      // No full re-build offer this time
      for (const notification of await workbench.getNotifications()) {
        expect(await notification.getMessage()).not.toContain(
          `The incremental re-build of ${envName} failed`
        );
      }
    } finally {
      editManagerCpp(EXTENDED_DELETE_RECORD, ORIGINAL_DELETE_RECORD);
    }
  });

  it("should validate test deletion", async () => {
    await updateTestID();

    console.log("Looking for Manager::PlaceOrder in the test tree");
    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem;
    let testHandle: TreeItem;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand();
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "myThirdTest",
          3
        );
        if (testHandle) {
          break;
        } else {
          throw new Error("Test handle not found for myThirdTest");
        }
      }
    }

    if (!subprogram) {
      throw new Error("Subprogram 'manager' not found");
    }

    console.log("Prepared test deletion");
    await deleteTest(testHandle as CustomTreeItem);

    const workbench = await browser.getWorkbench();
    const bottomBar = workbench.getBottomBar();
    const outputView = await bottomBar.openOutputView();

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data"),
      { timeout: TIMEOUT }
    );
    await browser.pause(10_000);

    await assertTestsDeleted("DATABASE-MANAGER", "myThirdTest");
    await browser.takeScreenshot();
    await browser.saveScreenshot("info_deleted_third_test.png");
  });

  it("should build VectorCAST environment from .env", async () => {
    await updateTestID();
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    await (await bottomBar.openOutputView()).clearText();

    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");

    await workspaceFolderSection.expand();
    const vceFile = await workspaceFolderSection.findItem(
      "DATABASE-MANAGER-test.env"
    );
    const vceMenu = await vceFile.openContextMenu();
    await vceMenu.select("Build VectorCAST Environment");
    await bottomBar.maximize();
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("Environment built Successfully"),
      { timeout: TIMEOUT }
    );
    await bottomBar.restore();
  });

  it("should open VectorCAST from .vce", async () => {
    await updateTestID();
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();
    process.env.QT_DEBUG_PLUGINS = "1";

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");

    await workspaceFolderSection.expand();
    const vceFile = await workspaceFolderSection.findItem(
      "DATABASE-MANAGER-TEST.vce"
    );
    const vceMenu = await vceFile.openContextMenu();
    await vceMenu.select("Open VectorCAST Environment");

    let checkVcastQtCmd = "ps -ef";
    if (process.platform == "win32") checkVcastQtCmd = "tasklist";

    let lastStdout = "";

    await bottomBar.maximize();
    await browser.waitUntil(
      async () => {
        const { stdout, stderr } = await promisifiedExec(checkVcastQtCmd);
        if (stderr) {
          console.log(`Error when running ${checkVcastQtCmd}`);
          console.log(stderr);
        }
        lastStdout = stdout;
        return stdout.includes("vcastqt");
      },
      {
        timeout: TIMEOUT,
      }
    );
    expect(lastStdout).toContain("vcastqt");

    let stopVcastCmd = "pkill vcastqt";
    if (process.platform == "win32")
      stopVcastCmd = `taskkill /IM "vcastqt.exe" /F`;
    {
      const { stdout, stderr } = await promisifiedExec(stopVcastCmd);
      if (stderr) {
        console.log(stderr);
        throw new Error(`Error when running ${stopVcastCmd}`);
      }

      console.log(stdout);
    }
  });

  // ─── incremental re-build helpers ────────────────────────────────

  // Manager::ClearTable in the tutorial's manager.cpp
  const ORIGINAL_CLEAR_TABLE = "void Manager::ClearTable(unsigned int Table)";
  const RENAMED_CLEAR_TABLE =
    "void Manager::ClearTable(unsigned int TableNumber)";
  const ORIGINAL_DELETE_RECORD = "  Data.DeleteRecord(Table);";
  const EXTENDED_DELETE_RECORD = "  (void)Table;\n  Data.DeleteRecord(Table);";

  /**
   * Replace `from` with `to` in the workspace's manager.cpp on disk. The file
   * is open in the editor with no unsaved changes, so VS Code picks up the
   * change and the environment sees a modified unit. A renamed parameter has
   * to be replaced in the body too, so the harness still compiles and the
   * incremental re-build fails for the interface change alone.
   */
  function editManagerCpp(from: string, to: string) {
    const managerCpp = path.join(
      process.env.INIT_CWD,
      "test",
      "vcastTutorial",
      "cpp",
      "manager.cpp"
    );
    let content = fs.readFileSync(managerCpp, "utf8");
    if (from === ORIGINAL_CLEAR_TABLE) {
      content = content.replace(
        "Data.DeleteRecord(Table);",
        "Data.DeleteRecord(TableNumber);"
      );
    } else if (from === RENAMED_CLEAR_TABLE) {
      content = content.replace(
        "Data.DeleteRecord(TableNumber);",
        "Data.DeleteRecord(Table);"
      );
    }
    expect(content).toContain(from);
    fs.writeFileSync(managerCpp, content.replace(from, to));
  }

  /** The first notification whose message contains `text`. */
  async function waitForNotification(text: string) {
    let found: Awaited<ReturnType<Workbench["getNotifications"]>>[number];
    await browser.waitUntil(
      async () => {
        for (const notification of await workbench.getNotifications()) {
          if ((await notification.getMessage()).includes(text)) {
            found = notification;
            return true;
          }
        }
        return false;
      },
      {
        timeout: TIMEOUT,
        timeoutMsg: `no notification containing '${text}' appeared`,
      }
    );
    return found;
  }
});
