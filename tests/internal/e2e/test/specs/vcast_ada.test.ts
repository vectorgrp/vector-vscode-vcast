// Test/specs/vcast_ada.test.ts
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
  deleteGeneratedTest,
  deleteAllTestsForEnv,
  updateTestID,
  insertAndRunAdaBasisPaths,
  readAdaGutterIcon,
  selectOutputChannel,
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

    // Collect every gutter mismatch across ALL coverage kinds and report them
    // together at the end, so a single run logs the actual icon for every line
    // (see the "[ada gutter]" logs) instead of failing on the first mismatch.
    const gutterMismatches: string[] = [];
    // Candidate decision/statement lines to inspect for each coverage kind.
    const candidateLines = [58, 62, 63, 67];

    for (const coverage of Object.keys(expectedGutters)) {
      // Focus the Explorer view BEFORE touching Settings (mirrors the C/C++
      // mcdc spec). This is essential: if the Testing pane stays focused while
      // we search Settings, the settings-search text ("Coverage Kind") leaks
      // into the Test Explorer's filter box and hides the whole tree, so the
      // env/units appear to vanish after the rebuild. Switching to Explorer
      // first, then re-activating Testing via getViewContent later, keeps the
      // Test Explorer filter clean.
      const explorerView = await workbench
        .getActivityBar()
        .getViewControl("Explorer");
      await explorerView?.openView();

      const outputView = await bottomBar.openOutputView();
      await outputView.clearText();

      const settingsEditor = await workbench.openSettings();
      const coverageKindSetting = await settingsEditor.findSetting(
        "Coverage Kind",
        "Vectorcast Test Explorer",
        "Build"
      );
      await coverageKindSetting.setValue(coverage);
      // Close the settings editor now that the value is set. This is safe for
      // the Test Explorer filter because we focused Explorer BEFORE opening
      // Settings (so the search text never reached the Testing filter), and it
      // keeps the editor area clean so the settings tab does not overlap /
      // interfere with the later tree and gutter interactions.
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

      // The extension repopulates the test pane after the rebuild (confirmed
      // via the updateTestsForEnvironment trace); getViewContent re-activates
      // the Testing view, so the env/units are found directly.
      await insertAndRunAdaBasisPaths(
        bottomBar,
        "MANAGER",
        "ADD_INCLUDED_DESSERT"
      );

      // Delete one basis-path test so that a partially covered branch appears
      // (3 basis paths are generated for the Ada subprogram).
      await deleteGeneratedTest(
        "MANAGER",
        "ADD_INCLUDED_DESSERT",
        "BASIS-PATH-002",
        3
      );

      // Log the ACTUAL gutter icon for each candidate line, and compare against
      // the expectation for this coverage kind (if any). Do not throw here -
      // collect mismatches so the run logs the full picture for all kinds.
      const expectedForKind = new Map(
        expectedGutters[coverage].map((g) => [g.line, g.icon])
      );
      for (const line of candidateLines) {
        const actual = await readAdaGutterIcon("manager.adb", line);
        const expectedIcon = expectedForKind.get(line);
        const matches = expectedIcon
          ? actual.includes(`/${expectedIcon}`)
          : undefined;
        console.log(
          `[ada gutter] coverage=${coverage} line=${line} ` +
            `expected=${expectedIcon ?? "(none)"} actual=${actual} ` +
            `match=${matches === undefined ? "(not checked)" : matches}`
        );
        if (expectedIcon && !actual.includes(`/${expectedIcon}`)) {
          gutterMismatches.push(
            `coverage=${coverage} line=${line}: expected "${expectedIcon}", actual="${actual}"`
          );
        }
      }
    }

    if (gutterMismatches.length > 0) {
      throw new Error(
        `Ada gutter icon mismatches (see the [ada gutter] logs above for the ` +
          `actual icons of every candidate line/coverage kind):\n` +
          gutterMismatches.join("\n")
      );
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

  // NOTE: The Reqs2X tests below require the Ada-capable reqs2tests distribution
  // ("autoreq-linux-with-ada"). The stock "autoreq-linux" distribution's
  // code2reqs cannot index Ada environments (fails at "Indexing codebase" with
  // "Translation unit file not found"); the with-ada distribution indexes Ada
  // envs fine (verified on 2026sp1, the CI version). CI must therefore point at
  // the with-ada distribution (e.g. via R2T_RELEASE_URL_LIN) for these to pass.
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

    // Keep the LLM-driven test generation as short as CI can tolerate: one
    // retry round instead of the default two. reqs2tests runtime is dominated by
    // per-requirement LLM calls (with retries), and the generate-tests test sits
    // right at the mocha per-test timeout - halving the retry rounds buys margin.
    // Set it directly (the settings UI label is version-sensitive).
    await browser.executeWorkbench((vscode) =>
      vscode.workspace
        .getConfiguration("vectorcastTestExplorer.reqs2x")
        .update("retries", 1, true)
    );
  });

  it("should generate requirements for the Ada environment", async () => {
    await updateTestID();

    const activityBar = workbench.getActivityBar();
    const outputView = await bottomBar.openOutputView();

    // Make sure no stale webview is open, so a freshly-opened Requirements
    // panel is an unambiguous success signal for the wait below.
    await workbench.getEditorView().closeAllEditors();

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

        // Wait for code2reqs to finish. On success the extension opens the
        // Requirements webview (showRequirements)
        let reqsOutput = "";
        try {
          await browser.waitUntil(
            async () => {
              // Primary signal: the Requirements panel opened => success.
              if ((await workbench.getAllWebviews()).length > 0) return true;

              // Secondary: read the reqs channel to catch a non-zero exit.
              await selectOutputChannel(
                "VectorCAST Requirement Test Generation Operations"
              );
              reqsOutput = (await outputView.getText()).toString();
              if (reqsOutput.includes("code2reqs exit code: 0")) return true;
              const nonZero = reqsOutput.match(/code2reqs exit code: (\d+)/);
              if (nonZero && nonZero[1] !== "0") {
                throw new Error(
                  `code2reqs exited with code ${nonZero[1]}:\n${reqsOutput}`
                );
              }
              return false;
            },
            { timeout: 240_000, interval: 3000 }
          );
        } catch (error) {
          // Make sure the dump shows the reqs channel, not whatever was active.
          await selectOutputChannel(
            "VectorCAST Requirement Test Generation Operations"
          );
          reqsOutput =
            (await (await bottomBar.openOutputView()).getText()).toString() ||
            reqsOutput;

          // Log whatever the Requirements webview panel shows (if the extension
          // opened one), so we can see whether ANY requirements were produced
          // before the failure.
          try {
            const webviews = await workbench.getAllWebviews();
            console.log(`[reqs panel] ${webviews.length} webview(s) open`);
            for (let i = 0; i < webviews.length; i++) {
              const wv = webviews[i];
              await wv.open();
              let bodyText = "";
              try {
                bodyText = (await (await $("body")).getText()).toString();
              } catch {
                bodyText = "(could not read body)";
              }
              let cardCount = 0;
              try {
                cardCount = await $$(".req[data-req-id]").length;
              } catch {
                /* not the requirements webview */
              }
              console.log(
                `[reqs panel] webview[${i}] requirementCards=${cardCount} body:\n${bodyText}`
              );
              await wv.close();
            }
          } catch (panelErr) {
            console.log(
              `[reqs panel] could not read Requirements panel: ${(panelErr as Error).message}`
            );
          }

          // Expand the bottom panel so the failure screenshot shows as much of
          // the reqs output as possible.
          try {
            await bottomBar.maximize();
          } catch {
            /* maximize not available; ignore */
          }

          throw new Error(
            `Generate Requirements (code2reqs) did not complete. Reqs output ` +
              `was:\n${reqsOutput}\n\n(original error: ${(error as Error).message})`
          );
        }
        break;
      }
    }
  });

  it("should generate tests from requirements into a clean Ada environment and check coverage", async function () {
    // reqs2tests is a real LLM (azure_openai) call, and its duration in CI is
    // highly variable - sometimes ~2 min, sometimes 20+ min when the endpoint
    // is slow/throttled. Give this one test a 40-min ceiling (vs the default
    // 20-min mochaOpts.timeout) so a slow-but-working run isn't flagged red.
    // Uses a regular function (not an arrow) so `this.timeout` is available.
    this.timeout(2_400_000);
    await updateTestID();

    // Stage timing so a slow/hanging run shows exactly where the time goes
    // (this test sits near the mocha per-test timeout).
    const t0 = Date.now();
    const stamp = (msg: string) =>
      console.log(
        `[reqs2tests] +${((Date.now() - t0) / 1000).toFixed(0)}s ${msg}`
      );

    // Start from a CLEAN environment (no tests) so that the tests appearing
    // afterwards are unambiguously the generated ones, and the coverage seen
    // afterwards comes only from them.
    await deleteAllTestsForEnv("DATABASE-MANAGER");
    stamp("env cleaned");

    // Locate PLACE_ORDER robustly. After deleteAllTestsForEnv the tree
    // re-renders, and the shared findSubprogram/findSubprogramMethod helpers
    // (which expand-walk every row and use a buggy no-await isExpanded) race
    // that refresh and can hang before we ever reach reqs2tests. Instead, poll
    // the visible rows for PLACE_ORDER, expanding the MANAGER unit as needed,
    // until it settles into view.
    let placeOrder: TreeItem | undefined;
    await browser.waitUntil(
      async () => {
        const vc = await getViewContent("Testing");
        for (const section of await vc.getSections()) {
          if (!(await section.isExpanded())) await section.expand();
          for (const item of await section.getVisibleItems()) {
            let text = "";
            try {
              text = (
                await (await (item as CustomTreeItem).elem).getText()
              ).trim();
            } catch {
              continue;
            }
            if (text === "PLACE_ORDER") {
              placeOrder = item as TreeItem;
              return true;
            }
            if (text === "MANAGER") {
              const unit = item as TreeItem;
              if (!(await unit.isExpanded())) {
                try {
                  await unit.expand();
                } catch {
                  /* best-effort */
                }
              }
            }
          }
        }
        return false;
      },
      {
        timeout: TIMEOUT,
        interval: 2000,
        timeoutMsg: "PLACE_ORDER did not appear in the Testing pane",
      }
    );
    stamp("PLACE_ORDER located");

    // Clear the reqs channel so we only see output from THIS invocation.
    const outputView = await bottomBar.openOutputView();
    await selectOutputChannel(
      "VectorCAST Requirement Test Generation Operations"
    );
    await outputView.clearText();

    const contextMenu = await placeOrder.openContextMenu();
    await contextMenu.select("VectorCAST");
    const menuElement = await $("aria/Generate Tests from Requirements");
    await menuElement.click();
    stamp("Generate Tests clicked");

    // Wait for reqs2tests to complete
    let genOutput = "";
    await browser.waitUntil(
      async () => {
        await selectOutputChannel(
          "VectorCAST Requirement Test Generation Operations"
        );
        genOutput = (await outputView.getText()).toString();
        const match = genOutput.match(/reqs2tests exit code: (\d+)/);
        if (!match) return false;
        if (match[1] !== "0") {
          throw new Error(
            `reqs2tests exited with code ${match[1]}:\n${genOutput}`
          );
        }
        return true;
      },
      {
        // 30 min - must stay below the 40-min per-test ceiling set above so a
        // genuine reqs2tests stall fails here (with output) rather than as an
        // opaque mocha timeout, while still leaving room for the run + gutter
        // stages that follow.
        timeout: 1_800_000,
        interval: 5000,
        timeoutMsg: `reqs2tests did not complete in time. Output:\n${genOutput}`,
      }
    );
    stamp("reqs2tests exit code 0");

    // The .tst import refreshes the tree, invalidating the pre-generate
    // placeOrder handle. Re-find it by scanning the visible rows for a
    // PLACE_ORDER node that now has children (the imported tests).
    let placeOrderFresh: TreeItem | undefined;
    await browser.waitUntil(
      async () => {
        const vc = await getViewContent("Testing");
        for (const section of await vc.getSections()) {
          if (!(await section.isExpanded())) await section.expand();
          for (const item of await section.getVisibleItems()) {
            let text = "";
            try {
              text = (
                await (await (item as CustomTreeItem).elem).getText()
              ).trim();
            } catch {
              continue;
            }
            if (text !== "PLACE_ORDER") continue;
            const po = item as TreeItem;
            if (!(await po.isExpanded())) await po.expand();
            if ((await po.getChildren()).length > 0) {
              placeOrderFresh = po;
              return true;
            }
          }
        }
        return false;
      },
      {
        timeout: TIMEOUT,
        interval: 2000,
        timeoutMsg: "No generated requirement tests appeared under PLACE_ORDER",
      }
    );
    stamp("generated tests imported under PLACE_ORDER");

    // Run the generated tests and wait for the run to finish before checking
    // coverage, so the gutters reflect this execution.
    await selectOutputChannel("VectorCAST Test Explorer");
    await outputView.clearText();
    await (
      await (
        await placeOrderFresh!.getActionButton("Run Test")
      ).elem
    ).click();
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data for:"),
      { timeout: TIMEOUT }
    );
    stamp("generated tests run");

    // Validate coverage with the Ada-aware gutter reader (it opens manager.adb
    // from the ada/ folder; checkForGutterAndGenerateReport assumes a cpp/
    // layout and would fail to locate the file). Any PLACE_ORDER execution
    // covers its entry statements, so require green ("/cover-icon", which also
    // matches the "-with-mcdc" green variant but not partial/no-cover) only on
    // the always-executed lines and allow the input-dependent ones to differ.
    const requiredGreenLines = [27, 31, 32, 33];
    const missingRequired: number[] = [];
    for (let line = 27; line <= 33; line++) {
      const url = await readAdaGutterIcon("manager.adb", line);
      const isGreen = url.includes("/cover-icon");
      console.log(`[reqs gutter] line=${line} green=${isGreen} url=${url}`);
      if (!isGreen && requiredGreenLines.includes(line)) {
        missingRequired.push(line);
      }
    }
    if (missingRequired.length > 0) {
      throw new Error(
        `Missing required green gutters on lines: ${missingRequired.join(", ")}`
      );
    }
  });
});
