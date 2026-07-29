// Test/specs/vcast_ada_project.test.ts
//
// End-to-end coverage for ADA support inside a managed VectorCAST PROJECT
// (.vcm), as opposed to the free-standing environment exercised by
// vcast_ada.test.ts. Ada is only validated on the latest VectorCAST release
// (see the "ada_project" group in specs_config.ts).
//
// This spec creates EVERYTHING itself:
//   - a new Ada project (createNewProject webview, language = Ada -> GNAT-on-host
//     ADACAST_.CFG compiler),
//   - an Ada environment INSIDE that project, built from manager.adb +
//     database.adb ("Create VectorCAST Environment in Project"),
//   - then runs the SAME checks as the free-env spec against the project env:
//     test tree (MANAGER + DATABASE), no coded tests, create+run a test, the
//     coverage-kind loop with per-kind gutter icons, and the MC/DC report.
//
// Project trees are deeper than free envs
// (AdaProject.vcm -> GNAT -> TestSuite -> DATABASE-MANAGER -> units), so
// expandProjectToEnv() expands down to the env node before the unit-level
// lookups (findSubprogram walks the visible rows, so the env node must be
// visible for its unit children to be found).
//
// GNAT + gprbuild must be on PATH (installed by the workflow's "Install GNAT"
// step).
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
  findTreeNodeAtLevel,
  executeContextMenuAction,
  getTestHandle,
  openTestScriptFor,
  checkElementExistsInHTML,
  checkForGutterAndGenerateReport,
  deleteGeneratedTest,
  insertAndRunAdaBasisPaths,
  readAdaGutterIcon,
  updateTestID,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";

const PROJECT_NAME = "AdaProject";
const ENV_NAME = "DATABASE-MANAGER";
// Levels in the project tree (0-based, relative to the Test Explorer section):
//   0: AdaProject.vcm   1: GNAT   2: TestSuite   3: DATABASE-MANAGER (env)
const ENV_LEVEL = 3;

// Click a button inside an extension notification ("VectorCAST Test Explorer
// (Extension)"), if it appears within timeoutMs. Returns whether it was clicked.
async function clickExtensionNotificationButton(
  label: string,
  timeoutMs: number
): Promise<boolean> {
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
}

// Expand the project tree down to (and including) the env node, so the unit
// children (MANAGER / DATABASE) become visible rows that findSubprogram can
// locate. Called at the start of every unit-level test because a rebuild can
// collapse/refresh the tree.
async function expandProjectToEnv(): Promise<TreeItem> {
  const envNode = await findTreeNodeAtLevel(ENV_LEVEL, ENV_NAME);
  if (!envNode) {
    throw new Error(
      `Env node "${ENV_NAME}" not found at level ${ENV_LEVEL} in the project tree`
    );
  }
  if (!(await envNode.isExpanded())) await envNode.expand();
  return envNode;
}

// Locate a unit (e.g. MANAGER) inside the project tree. Ensures the env node is
// expanded first, then walks the visible rows for the unit.
async function findUnitInProject(unit: string): Promise<TreeItem | undefined> {
  await expandProjectToEnv();
  const content = await getViewContent("Testing");
  for (const section of await content.getSections()) {
    const found = await findSubprogram(unit, section);
    if (found) return found;
  }
  return undefined;
}

describe("vTypeCheck VS Code Extension - Ada Project", () => {
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

  it("should create a new Ada VectorCAST project", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();

    // Open the "Create New Project" webview.
    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.createNewProject");
    });

    // Fill the webview: project name + Language = Ada, then Create. For Ada the
    // compiler section is hidden (the extension writes a minimal ADACAST_.CFG),
    // so there is no compiler to pick.
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webview = (await workbench.getAllWebviews())[0];
    await webview.open();
    const nameInput = await $("aria/Project Name Input");
    await nameInput.setValue(PROJECT_NAME);
    const languageSelect = await $("aria/Language");
    await languageSelect.selectByAttribute("value", "ada");
    await (await $("#btnSubmit")).click();
    await webview.close();

    // Ada is GNAT-on-host only -> the extension asks for confirmation. Continue.
    const confirmed = await clickExtensionNotificationButton("Continue", 30000);
    if (!confirmed) {
      const outputText = (
        await (await bottomBar.openOutputView()).getText()
      ).toString();
      throw new Error(
        "Ada project 'Continue' confirmation did not appear - the extension " +
          "likely reported that no GNAT toolchain was found on PATH. GNAT is a " +
          "prerequisite for Ada projects. Output was:\n" +
          outputText
      );
    }

    // Wait for the project (and its GNAT compiler) to be created.
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes(`Processing project: ${PROJECT_NAME}`),
      { timeout: TIMEOUT }
    );

    const projectNode = await findTreeNodeAtLevel(0, `${PROJECT_NAME}.vcm`);
    expect(projectNode).toBeDefined();
    const compilerNode = await findTreeNodeAtLevel(1, "GNAT");
    expect(compilerNode).toBeDefined();
  });

  it("should create an Ada environment inside the project from manager.adb + database.adb", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

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
    await (await $("aria/Create VectorCAST Environment in Project")).click();

    // The GNAT-on-host confirmation appears first (the command checks the
    // selected sources before opening the import webview).
    await clickExtensionNotificationButton("Continue", 30000);

    // The "Create Environment in Project" import webview opens; accept defaults
    // (compiler GNAT / testsuite TestSuite) with "Import OK".
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webview = (await workbench.getAllWebviews())[0];
    await webview.open();
    await (await $("aria/Import OK")).click();
    // Exit the webview iframe context so the output/notification reads below
    // target the main frame. The extension disposes the panel itself once
    // newEnvironment completes, so close() may race that - best-effort.
    try {
      await webview.close();
    } catch {
      // panel already disposed by the extension; ignore
    }

    // Wait for the env to be created in the project, failing fast (with the
    // output) on a reported failure instead of hanging the whole timeout.
    const failureMarkers = [
      "Environment Creation Failed",
      "Cannot Build Environment",
      "cannot find the source file",
      "Environment build failed",
    ];
    let createOutput = "";
    try {
      await browser.waitUntil(
        async () => {
          createOutput = (await outputView.getText()).toString();
          if (createOutput.includes(`Creating environment '${ENV_NAME}`)) {
            return true;
          }
          if (failureMarkers.some((m) => createOutput.includes(m))) {
            throw new Error(
              "Ada env-in-project creation reported a failure:\n" + createOutput
            );
          }
          return false;
        },
        { timeout: TIMEOUT, interval: 2000 }
      );
    } catch (error) {
      createOutput = createOutput || (await outputView.getText()).toString();
      throw new Error(
        `Ada env-in-project creation did not start. Output was:\n${createOutput}\n\n` +
          `(original error: ${(error as Error).message})`
      );
    }

    // The env node should appear in the project tree.
    await browser.waitUntil(
      async () =>
        (await findTreeNodeAtLevel(ENV_LEVEL, ENV_NAME)) !== undefined,
      {
        timeout: TIMEOUT,
        interval: 1000,
        timeoutMsg: `Env node "${ENV_NAME}" did not appear in the project tree`,
      }
    );

    const notificationsCenter = await workbench.openNotificationsCenter();
    await notificationsCenter.clearAllNotifications();
  });

  it("should build the Ada project environment", async () => {
    await updateTestID();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    await executeContextMenuAction(
      ENV_LEVEL,
      ENV_NAME,
      true,
      "Build Project Environment"
    );

    // Wait for the build, failing fast on a reported failure.
    const failureMarkers = [
      "Environment Creation Failed",
      "Cannot Build Environment",
      "Environment build failed",
    ];
    let buildOutput = "";
    try {
      await browser.waitUntil(
        async () => {
          buildOutput = (await outputView.getText()).toString();
          if (buildOutput.includes("Environment built Successfully")) {
            return true;
          }
          if (failureMarkers.some((m) => buildOutput.includes(m))) {
            throw new Error(
              "Ada project environment build reported a failure:\n" +
                buildOutput
            );
          }
          return false;
        },
        { timeout: TIMEOUT, interval: 2000 }
      );
    } catch (error) {
      buildOutput = buildOutput || (await outputView.getText()).toString();
      throw new Error(
        `Ada project environment did not build. Output was:\n${buildOutput}\n\n` +
          `(original error: ${(error as Error).message})`
      );
    }
  });

  it("should show the Ada units under test in the project test tree", async () => {
    await updateTestID();

    const manager = await findUnitInProject("MANAGER");
    const database = await findUnitInProject("DATABASE");

    expect(manager).not.toBe(undefined);
    expect(database).not.toBe(undefined);
  });

  it("should NOT offer coded tests for Ada (tree + autocompletion)", async () => {
    await updateTestID();

    const manager = await findUnitInProject("MANAGER");
    if (!manager) throw new Error("Unit 'MANAGER' not found");
    await manager.expand();

    // No coded_tests_driver node exists for Ada.
    const codedDriver = await findSubprogramMethod(
      manager,
      "Coded Tests"
    ).catch(() => undefined);
    expect(codedDriver).toBe(undefined);

    // Autocompletion: TEST.SUBPROGRAM: lists Ada subprograms, NOT
    // coded_tests_driver.
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
    expect(await contentAssist.hasItem("PLACE_ORDER")).toBe(true);
    expect(await contentAssist.hasItem("coded_tests_driver")).toBe(false);

    await editorView.closeEditor("vcast-template.tst");
  });

  it("should create and run an Ada test with a passing report", async () => {
    await updateTestID();

    const manager = await findUnitInProject("MANAGER");
    if (!manager) throw new Error("Unit 'MANAGER' not found");
    await manager.expand();

    const placeOrder = await findSubprogramMethod(manager, "PLACE_ORDER");
    if (!placeOrder) throw new Error("Subprogram 'PLACE_ORDER' not found");
    if (!placeOrder.isExpanded()) {
      await placeOrder.select();
    }

    // "New Test Script" scaffolds a valid test for PLACE_ORDER; rename it and
    // save (auto-loads).
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
    const managerAgain = await findUnitInProject("MANAGER");
    if (!managerAgain) throw new Error("Unit 'MANAGER' not found after save");
    await managerAgain.expand();
    const testHandle = await getTestHandle(
      managerAgain,
      "PLACE_ORDER",
      "adaFirstTest",
      1
    );
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

    // Same coverage-kind matrix as the free-env spec (verified icons per kind
    // on ADD_INCLUDED_DESSERT's decisions/statements).
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

    const gutterMismatches: string[] = [];
    const candidateLines = [58, 62, 63, 67];

    for (const coverage of Object.keys(expectedGutters)) {
      // Focus Explorer BEFORE Settings so the settings-search text does not leak
      // into the Test Explorer filter (see the free-env spec for the rationale).
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
      await workbench.getEditorView().closeAllEditors();

      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes(
              `Setting Up ${coverageKindOutputMapper[coverage]} Coverage`
            ),
        { timeout: TIMEOUT }
      );

      const rebuildFailureMarkers = [
        "Environment re-build failed",
        "Environment Creation Failed",
        "Aborting due to failed command",
        "ERROR: Could not find unit",
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
                `Ada project rebuild to ${coverage} coverage FAILED:\n${rebuildOutput}`
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
          `Ada project rebuild to ${coverage} coverage did not complete. ` +
            `Output was:\n${rebuildOutput}\n\n(original error: ${(error as Error).message})`
        );
      }

      // Re-expand the project tree to the env after the rebuild refresh, then
      // generate + run basis-path tests for the decision.
      await expandProjectToEnv();
      await insertAndRunAdaBasisPaths(
        bottomBar,
        "MANAGER",
        "ADD_INCLUDED_DESSERT"
      );

      await expandProjectToEnv();
      await deleteGeneratedTest(
        "MANAGER",
        "ADD_INCLUDED_DESSERT",
        "BASIS-PATH-002",
        3
      );

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
          `[ada project gutter] coverage=${coverage} line=${line} ` +
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
        `Ada project gutter icon mismatches (see the [ada project gutter] logs ` +
          `above):\n${gutterMismatches.join("\n")}`
      );
    }
  });

  it("should generate the MC/DC report for an Ada decision on manager.adb", async () => {
    await updateTestID();

    // Runs after the coverage-kind loop, so the env is Statement+MCDC with the
    // ADD_INCLUDED_DESSERT basis-path tests in place. Line 58 is the MC/DC
    // decision; its gutter shows the no-cover mcdc icon and right-clicking it ->
    // "VectorCAST MC/DC Report" produces the per-line report.
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();
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
    expect(await checkElementExistsInHTML("manager.adb")).toBe(true);
    expect(await checkElementExistsInHTML("ORDER.ENTREE = STEAK")).toBe(true);
    expect(await checkElementExistsInHTML("Pairs satisfied: 0 of 3")).toBe(
      true
    );
    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });
});
