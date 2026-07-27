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
//     built with Statement+MCDC,
//   - the environment building successfully,
//   - the test tree showing the Ada units under test (MANAGER + DATABASE),
//   - .tst autocompletion returning Ada subprograms but NOT coded_tests_driver
//     (coded tests do not exist for Ada),
//   - writing and running a test (results report),
//   - MCDC coverage gutters and the per-line MC/DC report on the Ada source,
//   - rebuilding through every coverage kind (Branch, Statement+Branch, MCDC,
//     Statement+MCDC) with per-kind gutter icons,
//   - Reqs2X: generating requirements from the Ada env, generating tests from
//     those requirements into a CLEAN env (so the generated tests are
//     unambiguous), running them and validating coverage,
// and documents the Ada capability matrix (what works vs. what is intentionally
// unavailable for Ada: coded tests, ATG).
//
// GNAT + gprbuild must be on PATH (installed by the workflow's "Install GNAT"
// step), and the reqs2tests distribution must be the Ada-capable build.
import {
  type BottomBarPanel,
  type TextEditor,
  type Workbench,
  type TreeItem,
  CustomTreeItem,
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
  generateBasisPathTestForSubprogram,
  deleteGeneratedTest,
  deleteAllTestsForEnv,
  updateTestID,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: any;

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

    // Create with the DEFAULT coverage kind. Do NOT open the Settings editor
    // here: the C/C++ specs only ever change Coverage Kind AFTER the env exists
    // (and then rely on the auto-rebuild). Touching Settings before the env is
    // created leaves the explorer/testing-pane interactions below "not
    // interactable". Statement+MCDC is established later by the coverage-kind
    // loop (proven setValue + auto-rebuild pattern), and the MCDC report test
    // runs after that loop, so the env is Statement+MCDC when it needs to be.
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

  it("should rebuild with each coverage kind and check Ada gutter icons", async () => {
    await updateTestID();

    // Rebuild the env through every coverage kind and verify the gutter icons on
    // ADD_INCLUDED_DESSERT's decision (line 58 = "if ORDER.ENTREE = STEAK and
    // ...", line 63 = the "elsif ... LOBSTER" branch, line 67 = the CAKE
    // statement). Mirrors the C/C++ mcdc spec's coverage-kind loop. Expected
    // icons were captured from a real build of each kind (basis-path tests for
    // ADD_INCLUDED_DESSERT, with BASIS-PATH-002 deleted to force a partial).
    //   - Branch / Statement+Branch use the plain icons (no MC/DC decisions
    //     exist in branch environments).
    //   - In MC/DC kinds, the "-with-mcdc" icons apply ONLY to MC/DC decision
    //     lines (58/63); plain statement lines (62) keep the plain icons. The
    //     auto basis-path tests do not satisfy any independence pair, so the
    //     decisions read uncovered.
    const coverageKindOutputMapper: Record<string, string> = {
      Branch: "Branch",
      "Statement+Branch": "Statement+Branch",
      MCDC: "MC/DC",
      "Statement+MCDC": "Statement+MC/DC",
    };
    const expectedGutters: Record<
      string,
      Array<{ line: number; icon: string }>
    > = {
      Branch: [
        { line: 58, icon: "cover-icon" },
        { line: 63, icon: "partially-cover-icon" },
      ],
      "Statement+Branch": [
        { line: 58, icon: "cover-icon" },
        { line: 63, icon: "partially-cover-icon" },
        { line: 67, icon: "no-cover-icon" },
      ],
      MCDC: [
        { line: 58, icon: "no-cover-icon-with-mcdc" },
        { line: 63, icon: "no-cover-icon-with-mcdc" },
      ],
      "Statement+MCDC": [
        { line: 62, icon: "cover-icon" },
        { line: 58, icon: "no-cover-icon-with-mcdc" },
      ],
    };

    for (const coverage of Object.keys(expectedGutters)) {
      const outputView = await bottomBar.openOutputView();
      await outputView.clearText();

      const settingsEditor = await workbench.openSettings();
      const coverageKindSetting = await settingsEditor.findSetting(
        "Coverage Kind",
        "Vectorcast Test Explorer",
        "Build"
      );
      await coverageKindSetting.setValue(coverage);
      // Close the settings editor so the later testing-pane interactions are not
      // blocked ("element not interactable").
      await workbench.getEditorView().closeAllEditors();

      // Wait for the rebuild to announce the new coverage kind.
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes(
              `Setting Up ${coverageKindOutputMapper[coverage]} Coverage`
            ),
        { timeout: TIMEOUT }
      );
      // Wait for the rebuild to COMPLETE, but fail fast (dumping the full
      // output) the moment it reports a failure - otherwise a broken Ada
      // rebuild just hangs for the whole 240s with no diagnostics. The Ada
      // rebuild round-trips the env through "enviro script create" + "enviro
      // build" + "test script run", any of which can fail (e.g. a lost GPR
      // PARENT_LIB path, or a test that no longer applies), so surface the
      // actual clicast output here.
      const rebuildFailureMarkers = [
        "Environment re-build failed",
        "Environment Creation Failed",
        "Aborting due to failed command",
        "ERROR: Could not find unit",
        "does not exist in the Repository",
      ];
      let rebuildOutput = "";
      try {
        await browser.waitUntil(
          async () => {
            rebuildOutput = (await outputView.getText()).toString();
            if (rebuildOutput.includes("Environment re-build complete")) {
              return true;
            }
            if (rebuildFailureMarkers.some((m) => rebuildOutput.includes(m))) {
              throw new Error(
                `Ada rebuild to ${coverage} coverage FAILED:\n${rebuildOutput}`
              );
            }
            return false;
          },
          { timeout: TIMEOUT, interval: 2000 }
        );
      } catch (error) {
        rebuildOutput =
          rebuildOutput || (await outputView.getText()).toString();
        throw new Error(
          `Ada rebuild to ${coverage} coverage did not complete. Output was:\n` +
            `${rebuildOutput}\n\n(original error: ${(error as Error).message})`
        );
      }

      // Generate basis-path tests for the decision, then delete one so that a
      // partially covered branch appears (3 basis paths are generated).
      await generateBasisPathTestForSubprogram(
        "MANAGER",
        "ADD_INCLUDED_DESSERT"
      );
      await deleteGeneratedTest(
        "MANAGER",
        "ADD_INCLUDED_DESSERT",
        "BASIS-PATH-002",
        3
      );

      for (const { line, icon } of expectedGutters[coverage]) {
        await checkForGutterAndGenerateReport(
          line,
          "manager.adb",
          icon,
          true,
          false
        );
      }
    }
  });

  it("should generate the MC/DC report for an Ada decision on manager.adb", async () => {
    await updateTestID();

    // Runs AFTER the coverage-kind loop, so the env is already Statement+MCDC
    // and ADD_INCLUDED_DESSERT's basis-path tests are in place (BASIS-PATH-002
    // deleted -> the decision reads uncovered). Line 58 (if ORDER.ENTREE = STEAK
    // and ...) is that MC/DC decision. We do not re-check plain statement
    // coverage of PLACE_ORDER here (validated by the run test earlier); a
    // rebuild in the loop above would not have re-executed that test, so its
    // gutter state is not asserted.
    //
    // Its gutter shows the no-cover mcdc icon (its condition pairs are not
    // satisfied), and right-clicking it -> "VectorCAST MC/DC Report" must
    // produce the per-line MC/DC report for the Ada decision. Clear the output
    // first so we wait for the NEW report, not stale "Report file path is:".
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
    // Signature: (line, unitFileName, icon, moveCursor, generateReport).
    await checkForGutterAndGenerateReport(
      58,
      "manager.adb",
      "no-cover-icon-with-mcdc",
      true,
      true
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
    const webview = (await workbench.getAllWebviews())[0];
    await webview.open();
    // The MC/DC report names the real Ada source, the decision, and its pair
    // status (0 of 3 satisfied for this uncovered decision).
    expect(await checkElementExistsInHTML("manager.adb")).toBe(true);
    expect(await checkElementExistsInHTML("ORDER.ENTREE = STEAK")).toBe(true);
    expect(await checkElementExistsInHTML("Pairs satisfied: 0 of 3")).toBe(
      true
    );
    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });

  it("should configure Reqs2X", async () => {
    await updateTestID();

    // Mirrors the requirements group's configuration steps: point at the
    // reqs2tests distribution, enable the feature, then configure azure_openai.
    let settingsEditor = await workbench.openSettings();
    const resourcePathSetting = await settingsEditor.findSetting(
      "Installation Location",
      "Vectorcast Test Explorer › Reqs2x"
    );
    console.log(
      `Setting Reqs2x installation location: ${process.env.REQS2TESTS_RESOURCES ?? "Failed to find Resources"}`
    );
    await resourcePathSetting.setValue(process.env.REQS2TESTS_RESOURCES ?? "");
    await workbench.getEditorView().closeAllEditors();

    settingsEditor = await workbench.openSettings();
    const enabledSetting = await settingsEditor.findSetting(
      "Enable Reqs2x Feature",
      "Vectorcast Test Explorer › Reqs2x"
    );
    await enabledSetting.setValue(true);
    await workbench.getEditorView().closeAllEditors();

    settingsEditor = await workbench.openSettings();
    const providerSetting = await settingsEditor.findSetting(
      "Provider",
      "Vectorcast Test Explorer › Reqs2x"
    );
    await providerSetting.setValue("azure_openai");
    await workbench.getEditorView().closeAllEditors();

    settingsEditor = await workbench.openSettings();
    const apiKeySetting = await settingsEditor.findSetting(
      "Api Key",
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    await apiKeySetting.setValue(
      process.env.OPENAI_API_KEY ?? "Failed to find API Key"
    );
    await workbench.getEditorView().closeAllEditors();

    settingsEditor = await workbench.openSettings();
    const urlSetting = await settingsEditor.findSetting(
      "Base Url",
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    await urlSetting.setValue(
      process.env.AZURE_BASE_URL ?? "Failed to find Base URL"
    );
    await workbench.getEditorView().closeAllEditors();

    settingsEditor = await workbench.openSettings();
    const deploymentSetting = await settingsEditor.findSetting(
      "Deployment",
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    await deploymentSetting.setValue("gpt-4.1-mini");
    await workbench.getEditorView().closeAllEditors();

    settingsEditor = await workbench.openSettings();
    const modelSetting = await settingsEditor.findSetting(
      "Model Name",
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    await modelSetting.setValue("gpt-4.1-mini");
    await workbench.getEditorView().closeAllEditors();

    settingsEditor = await workbench.openSettings();
    const apiVersionSetting = await settingsEditor.findSetting(
      "Api Version",
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    await apiVersionSetting.setValue("2024-12-01-preview");
    await workbench.getEditorView().closeAllEditors();
  });

  it("should generate requirements for the Ada environment", async () => {
    await updateTestID();

    const activityBar = workbench.getActivityBar();
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
    const vcastTestingViewContent = await getViewContent("Testing");

    await (await vcastTestingViewContent.elem).click();
    const sections = await vcastTestingViewContent.getSections();
    const testExplorerSection = sections[0];
    const testEnvironments = await testExplorerSection.getVisibleItems();

    // Go through the (only) env and click on Generate Requirements - mirrors
    // the C/C++ requirements spec, but against the Ada environment.
    for (const testEnvironment of testEnvironments) {
      let testEnvironmentContextMenu;
      try {
        testEnvironmentContextMenu = await (
          testEnvironment as CustomTreeItem
        ).openContextMenu();
      } catch {
        console.log("Cannot open context menu, not an environment");
        break;
      }

      if (testEnvironmentContextMenu != undefined) {
        await testEnvironmentContextMenu.select("VectorCAST");
        const generateButton = await $("aria/Generate Requirements");
        if (generateButton == undefined) break;
        await generateButton.click();

        // code2reqs must handle the Ada environment and exit cleanly.
        await browser.waitUntil(
          async () =>
            (await (await bottomBar.openOutputView()).getText())
              .toString()
              .includes("code2reqs exit code: 0"),
          { timeout: 240_000 }
        );
        break;
      }
    }
  });

  it("should generate tests from requirements into a clean Ada environment and check coverage", async () => {
    await updateTestID();

    // Start from a CLEAN environment (no tests) so that the tests appearing
    // afterwards are unambiguously the generated ones, and the coverage seen
    // afterwards comes only from them.
    await deleteAllTestsForEnv("DATABASE-MANAGER");

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

    // Clear the reqs channel so we only see output from THIS invocation.
    const outputView = await bottomBar.openOutputView();
    try {
      await outputView.selectChannel(
        "VectorCAST Requirement Test Generation Operations"
      );
    } catch (err) {
      console.warn("selectChannel failed, continuing anyway:", err.message);
    }
    await outputView.clearText();

    const contextMenu = await placeOrder.openContextMenu();
    await contextMenu.select("VectorCAST");
    const menuElement = await $("aria/Generate Tests from Requirements");
    await menuElement.click();

    // Wait for reqs2tests to finish (LLM-driven, so allow plenty of time).
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("reqs2tests exit code: 0"),
      { timeout: 240_000 }
    );

    // The environment was clean, so any test under PLACE_ORDER now was
    // generated from the requirements.
    await browser.waitUntil(
      async () => (await placeOrder.getChildren()).length > 0,
      {
        timeout: TIMEOUT,
        timeoutMsg: "No generated requirement tests appeared under PLACE_ORDER",
      }
    );

    // Run the generated tests and validate coverage: any PLACE_ORDER execution
    // covers its entry statements. Generated test names/inputs vary (LLM), so
    // require green gutters only on the always-executed lines and allow the
    // input-dependent ones to differ - same approach as the C/C++
    // requirements spec.
    try {
      await outputView.selectChannel("VectorCAST Test Explorer");
    } catch (err) {
      console.warn("selectChannel failed, continuing anyway:", err.message);
    }
    await (await (await placeOrder.getActionButton("Run Test")).elem).click();

    const requiredGreenLines = new Set<number>([27, 31, 32, 33]);
    const missingRequired: number[] = [];
    for (let line = 27; line <= 33; line++) {
      try {
        await checkForGutterAndGenerateReport(
          line,
          "manager.adb",
          "cover-icon",
          true,
          false
        );
        console.log(`Line ${line} has a green gutter`);
      } catch {
        if (requiredGreenLines.has(line)) {
          missingRequired.push(line);
        } else {
          console.log(`Line ${line} has no green gutter (allowed)`);
        }
      }
    }
    if (missingRequired.length > 0) {
      throw new Error(
        `Missing required green gutters on lines: ${missingRequired.join(", ")}`
      );
    }
  });
});
