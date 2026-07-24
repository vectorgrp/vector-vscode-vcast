// Test/specs/vcast_ada.test.ts
//
// End-to-end coverage for ADA environment support, in a single spec. Ada is
// only validated on the latest VectorCAST release (see the "ada" group in
// specs_config.ts, gated on useLatest), because the Ada integration targets the
// newest release.
//
// The Ada tutorial sources (manager.adb / database.adb / ...) are copied into
// the workspace's "ada" folder by wdio.conf.ts. From them this spec exercises:
//   - creating an Ada environment from source (GNAT-on-host confirm dialog),
//   - the environment building successfully,
//   - the test tree showing the Ada units under test (MANAGER + DATABASE),
//   - .tst autocompletion returning Ada subprograms but NOT coded_tests_driver
//     (coded tests do not exist for Ada),
//   - writing and running a test (results report),
//   - coverage gutter decorations on the real Ada source file,
// and documents the Ada capability matrix (what works vs. what is intentionally
// unavailable for Ada: coded tests, ATG).
import {
  type BottomBarPanel,
  type TextEditor,
  type Workbench,
  type TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  releaseCtrl,
  executeCtrlClickOn,
  expandWorkspaceFolderSectionInExplorer,
  getViewContent,
  findSubprogram,
  findSubprogramMethod,
  getTestHandle,
  openTestScriptFor,
  checkElementExistsInHTML,
  checkForGutterAndGenerateReport,
  updateTestID,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: any;
  // The env created from manager.adb + database.adb; its name is derived from
  // the source basenames exactly like the C/C++ flow (DATABASE-MANAGER).
  const adaEnvName = "DATABASE-MANAGER";

  before(async () => {
    workbench = await browser.getWorkbench();
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
    for (const character of "vector") {
      await browser.keys(character);
    }
    await browser.keys(Key.Enter);

    const activityBar = workbench.getActivityBar();
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

  it("should create an Ada VectorCAST environment from manager.adb + database.adb", async () => {
    await updateTestID();

    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");
    const adaFolder = workspaceFolderSection.findItem("ada");
    await (await adaFolder).select();

    // Multi-select the two Ada bodies (the .adb are the UUT bodies).
    const managerAdb = await workspaceFolderSection.findItem("manager.adb");
    const databaseAdb = await workspaceFolderSection.findItem("database.adb");
    await executeCtrlClickOn(databaseAdb);
    await executeCtrlClickOn(managerAdb);
    await releaseCtrl();

    await databaseAdb.openContextMenu();
    await (await $("aria/Create VectorCAST Environment")).click();

    // The extension shows notifications from "VectorCAST Test Explorer
    // (Extension)". Open the Notifications center ONCE (clicking the
    // "Notifications" bell toggles it, so re-opening it per-prompt would close
    // it and the second prompt's button would never be clicked). Then click each
    // expected button inside the notification, if present.
    try {
      await (await $("aria/Notifications")).click();
    } catch {
      // bell not present / already open
    }
    const clickExtensionNotificationButton = async (
      label: string,
      timeoutMs: number
    ): Promise<boolean> => {
      try {
        const source = await $("aria/VectorCAST Test Explorer (Extension)");
        await source.waitForExist({ timeout: timeoutMs });
        const notification = await source.$("..");
        const button = await notification.$(`aria/${label}`);
        await button.waitForExist({ timeout: timeoutMs });
        await button.click();
        return true;
      } catch {
        return false;
      }
    };

    // Ada is GNAT-on-host only, so the extension asks for confirmation first -
    // click "Continue". This notification is synchronous, so it appears almost
    // immediately; use a short wait and fail fast (rather than the 240s build
    // TIMEOUT) if it never shows. The most common reason it does not appear is a
    // missing GNAT toolchain: VectorCAST does not bundle GNAT, so the CI image
    // must provide gnat/gprbuild on PATH for Ada environments to build.
    const confirmed = await clickExtensionNotificationButton("Continue", 30000);
    if (!confirmed) {
      const outputText = (
        await (await bottomBar.openOutputView()).getText()
      ).toString();
      throw new Error(
        "Ada 'Continue' confirmation did not appear - the extension likely " +
          "reported that no GNAT toolchain was found on PATH. GNAT is a " +
          "prerequisite for Ada environments (VectorCAST does not bundle it); " +
          "install gnat/gprbuild in the test environment. Output was:\n" +
          outputText
      );
    }

    // On first creation in a fresh workspace the extension also asks to create
    // the unit-test directory. Click "Yes" if that notification appears.
    await clickExtensionNotificationButton("Yes", 15000);

    // Wait for the build to finish. We wait for EITHER success or a failure
    // marker so a broken build fails fast (with the output) instead of hanging
    // for the full timeout with no diagnostics.
    console.log("Waiting for the Ada environment to build");
    const readOutput = async () =>
      (await (await bottomBar.openOutputView()).getText()).toString();
    const failureMarkers = [
      "Environment Creation Failed",
      "Cannot Build Environment",
      "No preprocessor command specified",
      "cannot find the source file",
      "Environment build failed",
    ];
    let buildOutput = "";
    try {
      await browser.waitUntil(
        async () => {
          buildOutput = await readOutput();
          if (buildOutput.includes("Environment built Successfully")) {
            return true;
          }
          if (failureMarkers.some((m) => buildOutput.includes(m))) {
            throw new Error(
              "Ada environment build reported a failure:\n" + buildOutput
            );
          }
          return false;
        },
        { timeout: TIMEOUT, interval: 2000 }
      );
    } catch (error) {
      // On timeout (or an explicit failure above) surface the full output so
      // the failure is diagnosable from the CI log.
      buildOutput = buildOutput || (await readOutput());
      throw new Error(
        `Ada environment did not build. Output was:\n${buildOutput}\n\n` +
          `(original error: ${(error as Error).message})`
      );
    }
  });

  it("should show the Ada units under test in the test tree", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    let manager: TreeItem;
    let database: TreeItem;

    for (const section of await vcastTestingViewContent.getSections()) {
      await section.expand();
      // Ada unit names are upper-case (MANAGER / DATABASE), unlike C/C++.
      manager = manager || (await findSubprogram("MANAGER", section));
      database = database || (await findSubprogram("DATABASE", section));
    }

    // Both selected units are UUTs, so both must appear.
    expect(manager).not.toBe(undefined);
    expect(database).not.toBe(undefined);
  });

  it("should NOT offer coded tests for Ada (tree + autocompletion)", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    let manager: TreeItem;
    for (const section of await vcastTestingViewContent.getSections()) {
      manager = await findSubprogram("MANAGER", section);
      if (manager) {
        await manager.expand();
        break;
      }
    }
    if (!manager) throw new Error("Unit 'MANAGER' not found");

    // No coded_tests_driver node exists for Ada.
    const codedDriver = await findSubprogramMethod(
      manager,
      "Coded Tests"
    ).catch(() => undefined);
    expect(codedDriver).toBe(undefined);

    // Autocompletion: TEST.SUBPROGRAM: must list Ada subprograms, and must NOT
    // include coded_tests_driver.
    const placeOrder = await findSubprogramMethod(manager, "PLACE_ORDER");
    if (!placeOrder) throw new Error("Subprogram 'PLACE_ORDER' not found");
    if (!placeOrder.isExpanded()) {
      await placeOrder.select();
    }

    await openTestScriptFor(placeOrder as any);
    const tab = (await editorView.openEditor(
      "vcast-template.tst"
    )) as TextEditor;

    const contentAssist = await tab.toggleContentAssist(true);
    const currentLine = await tab.getLineOfText("TEST.SUBPROGRAM:PLACE_ORDER");
    await tab.setTextAtLine(currentLine, "TEST.SUBPROGRAM");
    await tab.typeTextAt(currentLine, "TEST.SUBPROGRAM".length + 1, ":");

    await browser.waitUntil(
      async () => (await contentAssist.getItems()).length > 0,
      { timeout: TIMEOUT }
    );
    // The real Ada subprogram is offered ...
    expect(await contentAssist.hasItem("PLACE_ORDER")).toBe(true);
    // ... but coded_tests_driver is NOT (coded tests do not exist for Ada).
    expect(await contentAssist.hasItem("coded_tests_driver")).toBe(false);

    await editorView.closeEditor("vcast-template.tst");
  });

  it("should create and run an Ada test with a passing report", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    let manager: TreeItem;
    for (const section of await vcastTestingViewContent.getSections()) {
      manager = await findSubprogram("MANAGER", section);
      if (manager) {
        await manager.expand();
        break;
      }
    }
    if (!manager) throw new Error("Unit 'MANAGER' not found");

    const placeOrder = await findSubprogramMethod(manager, "PLACE_ORDER");
    if (!placeOrder) throw new Error("Subprogram 'PLACE_ORDER' not found");
    if (!placeOrder.isExpanded()) {
      await placeOrder.select();
    }

    // Use the proven "New Test Script" flow: it scaffolds a full, valid test
    // template for PLACE_ORDER (TEST.NAME defaults to "test-PLACE_ORDER"). We
    // only rename the test; PLACE_ORDER executes on its entry statement with
    // default inputs, which is enough to produce coverage. Saving auto-loads it.
    await openTestScriptFor(placeOrder as any);
    const tab = (await editorView.openEditor(
      "vcast-template.tst"
    )) as TextEditor;

    const findWidget = await tab.openFindWidget();
    await findWidget.setSearchText("TEST.NAME:test-PLACE_ORDER");
    await findWidget.toggleReplace(true);
    await findWidget.setReplaceText("TEST.NAME:adaFirstTest");
    await findWidget.replace();
    await browser.keys([Key.Escape]);
    await tab.save();

    // Find and run the test.
    let testHandle: TreeItem;
    const refreshed = await getViewContent("Testing");
    for (const section of await refreshed.getSections()) {
      manager = await findSubprogram("MANAGER", section);
      if (manager) {
        await manager.expand();
        testHandle = await getTestHandle(
          manager,
          "PLACE_ORDER",
          "adaFirstTest",
          1
        );
        if (testHandle) break;
      }
    }
    if (!testHandle) throw new Error("Test handle for adaFirstTest not found");

    await testHandle.select();
    await (await (await testHandle.getActionButton("Run Test")).elem).click();

    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webview = (await workbench.getAllWebviews())[0];
    await webview.open();
    expect(await checkElementExistsInHTML("Execution Results (PASS)")).toBe(
      true
    );
    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });

  it("should show coverage gutter decorations on manager.adb", async () => {
    await updateTestID();

    // After running the test above, the real Ada source should carry coverage.
    // A green (covered) gutter on the PLACE_ORDER body confirms coverage flows
    // for Ada exactly as for C/C++. We look for a covered icon somewhere in the
    // file; the exact line is validated inside the helper.
    // Line 31 (TABLE_DATA.IS_OCCUPIED := true;) is the first executable
    // statement of PLACE_ORDER, so it is covered once the test runs. The helper
    // scrolls to the line and asserts the covered-icon gutter background. We
    // only check the gutter (generateReport = false) - no MC/DC report, since
    // this is a statement-coverage environment.
    await checkForGutterAndGenerateReport(
      31,
      "manager.adb",
      "cover-icon",
      false,
      true
    );
  });
});
