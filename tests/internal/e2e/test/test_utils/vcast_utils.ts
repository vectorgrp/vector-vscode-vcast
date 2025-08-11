import { promisify } from "node:util";
import { exec } from "node:child_process";
import path from "node:path";
import {
  CustomTreeItem,
  type TextEditor,
  type ViewSection,
  type ViewItem,
  type TreeItem,
  ViewContent,
  ContentAssist,
  ContentAssistItem,
  BottomBarPanel,
  OutputView,
} from "wdio-vscode-service";
import * as fs from "fs";
import { Key } from "webdriverio";
import expectedBasisPathTests from "../basis_path_tests.json";
import expectedAtgTests from "../atg_tests.json";

// Local VM takes longer and needs a higher TIMEOUT
export const TIMEOUT = 180_000;

export type ServerMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "HEAD"
  | "OPTIONS";

export interface ServerOptions {
  hostname: string;
  port: number;
  path: string;
  method: ServerMethod;
}

const promisifiedExec = promisify(exec);
export async function updateTestID() {
  const testIDEnvVariable = process.env.E2E_TEST_ID;
  if (testIDEnvVariable) {
    const testID = Number.parseInt(testIDEnvVariable) + 1;
    process.env.E2E_TEST_ID = testID.toString();
  }
}

export async function cleanup() {
  console.log("Cleanup");
  console.log("Deleting all environments");

  const workbench = await browser.getWorkbench();
  const bottomBar = workbench.getBottomBar();
  const vcastTestingViewContent = await getViewContent("Testing");
  await (await vcastTestingViewContent.elem).click();
  const sections = await vcastTestingViewContent.getSections();
  const testExplorerSection = sections[0];
  const testEnvironments = await testExplorerSection.getVisibleItems();
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
      const deleteButton = await $("aria/Delete Environment");
      if (deleteButton == undefined) break;

      await deleteButton.click();

      const vcastNotificationSourceElement = await $(
        "aria/VectorCAST Test Explorer (Extension)"
      );
      const vcastNotification = await vcastNotificationSourceElement.$("..");
      await (await vcastNotification.$("aria/Delete")).click();
      await bottomBar.maximize();

      await browser.waitUntil(
        async () =>
          (await (await bottomBar.openOutputView()).getText())
            .toString()
            .includes("Successful deletion of environment"),
        { timeout: 30_000 }
      );
      await (await bottomBar.openOutputView()).clearText();
      await bottomBar.restore();
    }
  }

  console.log("Done deleting all environments");
  console.log("Removing folders");

  const initialWorkdir = process.env.INIT_CWD;
  const pathToTutorial = path.join(
    initialWorkdir,
    "test",
    "vcastTutorial",
    "cpp"
  );

  const vscodeSettingsPath = path.join(
    initialWorkdir,
    "test",
    "vcastTutorial",
    ".vscode"
  );

  const launchJsonPath = path.join(vscodeSettingsPath, "launch.json");
  const unitTestsPath = path.join(pathToTutorial, "unitTests");
  const qikPath = path.join(pathToTutorial, "VCAST.QIK");

  let clearLaunchJson = "";
  let createLaunchJson = "";
  let clearUnitTestsFolder = "";
  let clearQik = "";

  if (process.platform == "win32") {
    clearLaunchJson = `del ${launchJsonPath}`;
    createLaunchJson = `copy /b NUL ${launchJsonPath}`;
    clearUnitTestsFolder = `rmdir /s /q ${unitTestsPath}`;
    clearQik = `del ${qikPath}`;
  } else {
    clearLaunchJson = `rm -rf ${launchJsonPath}`;
    createLaunchJson = `touch ${launchJsonPath}`;
    clearUnitTestsFolder = `rm -rf ${unitTestsPath}`;
    clearQik = `rm -rf ${qikPath}`;
  }

  await promisifiedExec(clearLaunchJson);
  await promisifiedExec(createLaunchJson);
  await promisifiedExec(clearUnitTestsFolder);
  await promisifiedExec(clearQik);
}

export async function getGeneratedTooltipTextAt(
  line: number,
  column: number,
  tab: TextEditor
) {
  await tab.moveCursor(line, column);
  const activeElement = await (await tab.elem).getActiveElement();
  await $(activeElement).moveTo({ xOffset: 0, yOffset: 0 });

  const tooltip = await $('[monaco-visible-content-widget="true"]');
  await tooltip.waitForExist();
  const tooltipText = await tooltip.getText();
  return tooltipText;
}

export async function executeCtrlClickOn(fileInFolderView: ViewItem) {
  await (await fileInFolderView.elem).click();
  await browser.performActions([
    {
      type: "pointer",
      id: "click1",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ],
    },
    {
      type: "key",
      id: "ctrl",
      actions: [{ type: "keyDown", value: Key.Control }],
    },
  ]);
}

export async function releaseCtrl() {
  await browser.performActions([
    {
      type: "key",
      id: "ctrl",
      actions: [{ type: "keyUp", value: Key.Control }],
    },
  ]);
}

export async function expandWorkspaceFolderSectionInExplorer(
  workspaceName: string
) {
  const workbench = await browser.getWorkbench();
  const activityBar = workbench.getActivityBar();
  const explorerView = await activityBar.getViewControl("Explorer");
  const explorerSideBarView = await explorerView?.openView();

  const workspaceFolderSection = await explorerSideBarView
    .getContent()
    .getSection(workspaceName.toUpperCase());

  await workspaceFolderSection.expand();

  return workspaceFolderSection;
}

export async function clickOnButtonInTestingHeader(buttonLabel: string) {
  const workbench = await browser.getWorkbench();
  const activityBar = workbench.getActivityBar();
  const testingView = await activityBar.getViewControl("Testing");
  const testingOpenView = await testingView?.openView();
  expect(testingOpenView).not.toBe(undefined);

  const testingViewTitlePart = testingOpenView.getTitlePart();
  await (await testingViewTitlePart.elem).click();

  const actionButton = await (
    await $(`aria/${buttonLabel}`)
  ).$("[role=button]");

  await actionButton.moveTo();
  await actionButton.click();
}

export async function getViewContent(viewName: string) {
  const workbench = await browser.getWorkbench();
  const activityBar = workbench.getActivityBar();
  const testingView = await activityBar.getViewControl(viewName);
  const vcastTestingView = await testingView?.openView();

  return vcastTestingView.getContent();
}

export async function expandAllSubprogramsFor(subprogramGroup: CustomTreeItem) {
  for (const subprogram of await subprogramGroup.getChildren()) {
    await subprogram.expand();
  }
}

/**
 * Retrieves the top-level items from a given testing view content.
 * @param vcastTestingViewContent Testing view content.
 * @returns Top-level items or undefined
 */
export async function retrieveTestingTopItems(
  vcastTestingViewContent: ViewContent
) {
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    if (!(await vcastTestingViewSection.isExpanded())) {
      await vcastTestingViewSection.expand();
    }
    // Get all top-level items (ENV_01, ENV_02, etc.)
    return await vcastTestingViewSection.getVisibleItems();
  }

  return undefined;
}

/**
 * Function that expands the top folder of the testing pane and returns it if available.
 * @param envName Name of the environment.
 * @param topLevelItems All Top level folders of the testing pane.
 * @returns "Folder item" or undefined if not found.
 */
export async function expandTopEnvInTestPane(
  envName: string,
  topLevelItems: CustomTreeItem[]
): Promise<CustomTreeItem> {
  for (const item of topLevelItems) {
    const itemName = await (await item.elem).getText();
    if (itemName === envName && !(await item.isExpanded())) {
      await item.expand();
      return item;
    }
  }

  return undefined;
}

export async function findSubprogram(
  subprogramName: string,
  viewSection: ViewSection
) {
  if (!(await viewSection.isExpanded())) await viewSection.expand();
  for (const visibleItem of await viewSection.getVisibleItems()) {
    const subprogramGroup = visibleItem as CustomTreeItem;
    if (!(await subprogramGroup.isExpanded())) await subprogramGroup.expand();

    await expandAllSubprogramsFor(subprogramGroup);

    for (const subprogram of await subprogramGroup.getChildren()) {
      const foundSubprogramName = await (
        await (subprogram as CustomTreeItem).elem
      ).getText();
      if (subprogramName === foundSubprogramName) {
        return subprogram;
      }
    }
  }

  return undefined;
}

export async function findSubprogramMethod(
  subprogram: TreeItem,
  expectedMethodName: string
) {
  await browser.waitUntil(
    async () => (await subprogram.getChildren()).length > 0
  );
  for (const subprogramMethod of await subprogram.getChildren()) {
    const subprogramMethodName = await (
      await (subprogramMethod as CustomTreeItem).elem
    ).getText();
    if (subprogramMethodName === expectedMethodName) {
      if (!subprogramMethod.isExpanded()) {
        await subprogramMethod.select();
      }

      return subprogramMethod as CustomTreeItem;
    }
  }

  return undefined;
}

export async function getTestHandle(
  subprogram: TreeItem,
  expectedMethodName: string,
  expectedTestName: string,
  totalNumberOfTestsForMethod: number
) {
  const customSubprogramMethod = await findSubprogramMethod(
    subprogram,
    expectedMethodName
  );
  if (!customSubprogramMethod.isExpanded()) {
    await customSubprogramMethod.select();
  }

  try {
    await browser.waitUntil(
      async () =>
        (await customSubprogramMethod.getChildren()).length ===
        totalNumberOfTestsForMethod,
      { timeout: 10000, timeoutMsg: `${expectedTestName} not found` }
    );
  } catch {
    return undefined;
  }

  for (const testHandle of await customSubprogramMethod.getChildren()) {
    const testName = await (
      await (testHandle as CustomTreeItem).elem
    ).getText();
    if (testName.includes(expectedTestName)) {
      return testHandle;
    }
  }

  return undefined;
}

export async function openTestScriptFor(subprogramMethod: CustomTreeItem) {
  const contextMenu = await subprogramMethod.openContextMenu();
  await contextMenu.select("VectorCAST");
  // For some reason, it does not want to click on New Test Script
  // when given as an argument in select
  // so doing it manually, this slows things down
  const menuElement = await $("aria/New Test Script");
  await menuElement.click();

  const workbench = await browser.getWorkbench();
  const editorView = workbench.getEditorView();
  await browser.waitUntil(
    async () =>
      (await (await editorView.getActiveTab()).getTitle()) ===
      "vcast-template.tst"
  );
}

/**
 * Generates Basis Path tests for a given subprogram method.
 * @param subprogramMethod Subprogram method for which to generate ATG tests.
 */
export async function insertBasisPathTestFor(subprogramMethod: CustomTreeItem) {
  let workbench = await browser.getWorkbench();
  let bottomBar = workbench.getBottomBar();
  const contextMenu = await subprogramMethod.openContextMenu();
  await contextMenu.select("VectorCAST");

  const menuElement = await $("aria/Insert Basis Path Tests");
  await menuElement.click();

  await browser.waitUntil(
    async () =>
      (await (await bottomBar.openOutputView()).getText())
        .toString()
        .includes("Script loaded successfully"),
    { timeout: TIMEOUT }
  );

  // Run the tests and wait for them to finish
  await (
    await (
      await subprogramMethod.getActionButton("Run Test")
    ).elem
  ).click();
  await browser.waitUntil(
    async () =>
      (await (await bottomBar.openOutputView()).getText())
        .toString()
        .includes("Starting execution of test: BASIS-PATH-004"),
    { timeout: TIMEOUT }
  );

  await browser.waitUntil(
    async () =>
      (await (await bottomBar.openOutputView()).getText())
        .toString()
        .includes("Processing environment data for:"),
    { timeout: TIMEOUT }
  );
}

export async function generateBasisPathTestForSubprogram(
  unit: string,
  subprogramName: string
) {
  const vcastTestingViewContent = await getViewContent("Testing");
  let subprogram: TreeItem;
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    if (!(await vcastTestingViewSection.isExpanded()))
      await vcastTestingViewSection.expand();

    for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
      console.log(await vcastTestingViewContentSection.getTitle());
      await vcastTestingViewContentSection.expand();
      subprogram = await findSubprogram(unit, vcastTestingViewContentSection);
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
    subprogramName
  );
  if (!subprogramMethod) {
    throw new Error(
      "Subprogram method 'Manager::AddIncludedDessert' not found"
    );
  }

  if (!subprogramMethod.isExpanded()) {
    await subprogramMethod.select();
  }

  await insertBasisPathTestFor(subprogramMethod);
}

export async function deleteTest(testHandle: CustomTreeItem) {
  const contextMenu = await testHandle.openContextMenu();
  await contextMenu.select("VectorCAST");
  // For some reason, it does not want to click on Delete Test
  // when given as an argument in select

  const menuElement = await $("aria/Delete Tests");
  await menuElement.click();
}

export async function editTestScriptFor(
  subprogramMethod: CustomTreeItem,
  testEnvironmentName: string
) {
  const contextMenu = await subprogramMethod.openContextMenu();
  await contextMenu.select("VectorCAST");
  // For some reason, it does not want to click on New Test Script
  // when given as an argument in select
  // so doing it manually, this slows things down
  const menuElement = await $("aria/Edit Test Script");
  await menuElement.click();

  const workbench = await browser.getWorkbench();
  const editorView = workbench.getEditorView();
  await browser.waitUntil(
    async () =>
      (await (await editorView.getActiveTab()).getTitle()) ===
      testEnvironmentName + ".tst"
  );
}

export enum testGenMethod {
  BasisPath = "Basis Path",
  ATG = "ATG",
}

export async function generateAllTestsForEnv(
  envName: string,
  testGenMethod: string
) {
  const menuItemLabel = `Insert ${testGenMethod} Tests`;

  const vcastTestingViewContent = await getViewContent("Testing");

  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();

      const subprogramGroup = visibleItem as CustomTreeItem;
      await expandAllSubprogramsFor(subprogramGroup);
      if ((await subprogramGroup.getTooltip()).includes(envName)) {
        await subprogramGroup.expand();
        const contextMenu = await subprogramGroup.openContextMenu();
        await contextMenu.select("VectorCAST");
        await (await $(`aria/${menuItemLabel}`)).click();

        const workbench = await browser.getWorkbench();
        const bottomBar = workbench.getBottomBar();

        await browser.waitUntil(async () =>
          (await (await bottomBar.openOutputView()).getText()).includes(
            "test explorer  [info]  Script loaded successfully"
          )
        );

        break;
      }
    }
  }
}

export async function validateGeneratedTestScriptContent(
  testHandle: TreeItem,
  expectedTestCode: string,
  envName: string
) {
  await testHandle.select();
  const contextMenu = await testHandle.openContextMenu();
  await contextMenu.select("VectorCAST");
  const menuElement = await $("aria/Edit Test Script");
  await menuElement.click();

  const workbench = await browser.getWorkbench();
  const editorView = workbench.getEditorView();
  const tstFilename = `${envName.split("/").at(-1)}.tst`;
  await browser.waitUntil(
    async () =>
      (await (await editorView.getActiveTab()).getTitle()) === tstFilename
  );
  const tab = (await editorView.openEditor(tstFilename)) as TextEditor;

  const fullGenTstScript = await tab.getText();

  await editorView.closeAllEditors();
  for (let line of expectedTestCode) {
    line = line.trim();
    expect(fullGenTstScript.includes(line)).toBe(true);
  }
}

export async function deleteAllTestsForEnv(envName: string) {
  const vcastTestingViewContent = await getViewContent("Testing");

  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();

      const subprogramGroup = visibleItem as CustomTreeItem;
      if ((await subprogramGroup.getTooltip()).includes(envName)) {
        await subprogramGroup.expand();
        const menuItemLabel = "Delete Tests";
        const contextMenu = await subprogramGroup.openContextMenu();
        await contextMenu.select("VectorCAST");
        await (await $(`aria/${menuItemLabel}`)).click();

        const vcastNotificationSourceElement = await $(
          "aria/VectorCAST Test Explorer (Extension)"
        );
        const vcastNotification = await vcastNotificationSourceElement.$("..");
        await (await vcastNotification.$("aria/Delete")).click();

        break;
      }
    }
  }
}

export async function validateTestDeletionForEnv(envName: string) {
  const vcastTestingViewContent = await getViewContent("Testing");
  const doneValidating = false;
  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();

      const subprogramGroup = visibleItem as CustomTreeItem;

      if ((await subprogramGroup.getTooltip()).includes(envName)) {
        for (const unit of await subprogramGroup.getChildren()) {
          const unitName = await unit.getTooltip();

          if (
            !unitName.includes("Compound") &&
            !unitName.includes("Initialization")
          ) {
            for (const method of await unit.getChildren()) {
              const methodName = await method.getTooltip();

              // This is flaky, it sometimes takes manager as Child element
              if (methodName.includes("::")) {
                await browser.waitUntil(
                  async () => (await method.hasChildren()) === false
                );
              }
            }
          }
        }

        // GetVisibleItems() literally gets the visible items, including leaves in the structure
        // important to stop the loop here, otherwise wdio starts doing random things and hangs
        if (doneValidating) break;
      }
    }

    if (doneValidating) break;
  }
}

export async function validateTestDeletionForUnit(
  envName: string,
  unitName: string
) {
  let doneValidating = false;
  const vcastTestingViewContent = await getViewContent("Testing");

  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();

      const subprogramGroup = visibleItem as CustomTreeItem;

      if ((await subprogramGroup.getTooltip()).includes(envName)) {
        for (const unit of await subprogramGroup.getChildren()) {
          const unitNameTooltip = await unit.getTooltip();

          if (unitNameTooltip.includes(unitName)) {
            for (const method of await unit.getChildren()) {
              const methodName = await method.getTooltip();

              // This is flaky, it sometimes takes manager as Child element
              if (methodName.includes("::")) {
                await browser.waitUntil(
                  async () => (await method.hasChildren()) === false
                );
              }
            }

            doneValidating = true;
            break;
          }
        }

        // GetVisibleItems() literally gets the visible items, including leaves in the structure
        // important to stop the loop here, otherwise wdio starts doing random things and hangs
        if (doneValidating) break;
      }
    }

    if (doneValidating) break;
  }
}

export async function validateTestDeletionForFunction(
  unitName: string,
  functionName: string,
  spotCheckTestName: string,
  totalNumberOfTestsForMethod: number
) {
  // Only checking if one of the tests can be found
  // This indicates that the test tree got refreshed
  await validateSingleTestDeletion(
    unitName,
    functionName,
    spotCheckTestName,
    totalNumberOfTestsForMethod
  );
}

export async function generateAndValidateAllTestsFor(
  envName: string,
  testGenMethod: string
) {
  await generateAllTestsForEnv(envName, testGenMethod);

  const vcastTestingViewContent = await getViewContent("Testing");
  const expectedTests = await getAllExpectedTests(testGenMethod);
  for (const [unitName, functions] of Object.entries(expectedTests[envName])) {
    for (const [functionName, tests] of Object.entries(functions)) {
      if (!tests) continue;
      for (const [testName, testCode] of Object.entries(tests)) {
        let subprogram: TreeItem;
        let testHandle: TreeItem;
        for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
          await vcastTestingViewSection.expand();
          subprogram = await findSubprogram(unitName, vcastTestingViewSection);
          if (subprogram) {
            await subprogram.expand();
            await browser.waitUntil(
              async () =>
                (await getTestHandle(
                  subprogram,
                  functionName,
                  testName,
                  Object.entries(tests).length
                )) != undefined,
              { timeout: 90_000, interval: 10_000 }
            );

            testHandle = await getTestHandle(
              subprogram,
              functionName,
              testName,
              Object.entries(tests).length
            );
            if (testHandle) {
              const expectedTestCode = await getExpectedTestCode(
                expectedTests,
                envName,
                unitName,
                functionName,
                testName
              );
              await validateGeneratedTestScriptContent(
                testHandle,
                expectedTestCode,
                envName
              );
              break;
            } else {
              throw `Test handle not found for ${envName}:${unitName}:${functionName}:${testName}`;
            }
          }
        }

        if (!subprogram) {
          throw `Subprogram ${unitName} not found`;
        }
      }
    }
  }
}

export async function generateFlaskIconTestsFor(
  line: number,
  testGenMethod: string,
  unitFileName: string
) {
  const workbench = await browser.getWorkbench();
  const activityBar = workbench.getActivityBar();
  const explorerView = await activityBar.getViewControl("Explorer");
  const explorerSideBarView = await explorerView?.openView();

  const workspaceFolderName = "vcastTutorial";
  const workspaceFolderSection = await explorerSideBarView
    .getContent()
    .getSection(workspaceFolderName.toUpperCase());

  await workspaceFolderSection.expand();

  const managerCpp = workspaceFolderSection.findItem(unitFileName);
  await (await managerCpp).select();

  const editorView = workbench.getEditorView();
  const tab = (await editorView.openEditor(unitFileName)) as TextEditor;

  await tab.moveCursor(line, 1);

  const lineNumberElement = await $(`.line-numbers=${line}`);
  const flaskElement = await (
    await lineNumberElement.parentElement()
  ).$(".cgmr.codicon");
  const backgroundImageCSS =
    await flaskElement.getCSSProperty("background-image");
  const backgroundImageURL = backgroundImageCSS.value;
  const BEAKER = "/beaker-plus";
  expect(backgroundImageURL.includes(BEAKER)).toBe(true);
  await flaskElement.click({ button: 2 });

  await (await $("aria/VectorCAST")).click();
  await (await $(`aria/Generate ${testGenMethod} Tests`)).click();
}

export async function validateGeneratedTest(
  testGenMethod: string,
  envName: string,
  unitName: string,
  functionName: string,
  testName: string,
  totalTestsForFunction = 1
) {
  let subprogram: TreeItem;
  const vcastTestingViewContent = await getViewContent("Testing");
  await (await vcastTestingViewContent.elem).click();
  console.log("Validating generated test");
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    console.log("Expanded testing view section");
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram) {
      const testHandle = await getTestHandle(
        subprogram,
        functionName,
        testName,
        totalTestsForFunction
      );
      expect(testHandle).not.toBe(undefined);
      const allExpectedTests = await getAllExpectedTests(testGenMethod);
      const expectedTestCode = await getExpectedTestCode(
        allExpectedTests,
        envName,
        unitName,
        functionName,
        testName
      );
      await validateGeneratedTestScriptContent(
        testHandle,
        expectedTestCode,
        envName
      );
      break;
    }
  }

  if (!subprogram) {
    throw `Subprogram ${unitName} not found`;
  }
}

export async function getExpectedTestCode(
  expectedTests: Record<string, unknown>,
  envName: string,
  unitName: string,
  functionName: string,
  testName: string
) {
  if (unitName == "database") {
    return expectedTests[envName].database[functionName][testName];
  }

  if (unitName == "manager") {
    return expectedTests[envName].manager[functionName][testName];
  }

  if (unitName == "quotes_example") {
    return expectedTests[envName].quotes_example[functionName][testName];
  }

  return undefined;
}

export async function getExpectedUnitInfo(
  expectedTests: Record<string, unknown>,
  envName: string,
  unitName: string
) {
  if (unitName == "database") {
    return expectedTests[envName].database;
  }

  if (unitName == "manager") {
    return expectedTests[envName].manager;
  }

  if (unitName == "quotes_example") {
    return expectedTests[envName].quotes_example;
  }
}

export async function getExpectedFunctionInfo(
  expectedTests: Record<string, unknown>,
  envName: string,
  unitName: string,
  functionName: string
) {
  if (unitName == "database") {
    return expectedTests[envName].database[functionName];
  }

  if (unitName == "manager") {
    return expectedTests[envName].manager[functionName];
  }

  if (unitName == "quotes_example") {
    return expectedTests[envName].quotes_example[functionName];
  }
}

export async function getAllExpectedTests(testGenMethodText: string) {
  if (testGenMethodText === testGenMethod.BasisPath) {
    return expectedBasisPathTests;
  }

  return expectedAtgTests;
}

export async function deleteGeneratedTest(
  unitName: string,
  functionName: string,
  testName: string,
  totalTestsForFunction = 1
) {
  let subprogram: TreeItem;
  const vcastTestingViewContent = await getViewContent("Testing");

  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand();
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram) {
      const testHandle = (await getTestHandle(
        subprogram,
        functionName,
        testName,
        totalTestsForFunction
      )) as CustomTreeItem;
      expect(testHandle).not.toBe(undefined);
      await deleteTest(testHandle);
      break;
    }
  }

  if (!subprogram) {
    throw `Subprogram ${unitName} not found`;
  }
}

export type vcastTest = {
  envName: string;
  unitName: string;
  functionName: string;
  testName: string;
  numTestsForFunction: number;
};

export async function multiselectDeletion(tests: vcastTest[]) {
  let subprogram: TreeItem;
  const vcastTestingViewContent = await getViewContent("Testing");

  const testHandles: CustomTreeItem[] = [];

  for (const vcastTest of tests) {
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand();
      subprogram = await findSubprogram(
        vcastTest.unitName,
        vcastTestingViewSection
      );
      if (subprogram) {
        const testHandle = (await getTestHandle(
          subprogram,
          vcastTest.functionName,
          vcastTest.testName,
          vcastTest.numTestsForFunction
        )) as CustomTreeItem;
        expect(testHandle).not.toBe(undefined);
        testHandles.push(testHandle);
        break;
      }
    }

    if (!subprogram) {
      throw `Subprogram ${vcastTest.unitName} not found`;
    }
  }

  for (const testHandle of testHandles) {
    await executeCtrlClickOn(testHandle);
  }

  await releaseCtrl();
  const contextMenu = await testHandles[0].openContextMenu();
  await contextMenu.select("VectorCAST");
  const menuElement = await $("aria/Delete Tests");
  await menuElement.click();

  const vcastNotificationSourceElement = await $(
    "aria/VectorCAST Test Explorer (Extension)"
  );
  const vcastNotification = await vcastNotificationSourceElement.$("..");
  await (await vcastNotification.$("aria/Delete")).click();
}

export async function validateSingleTestDeletion(
  unitName: string,
  functionName: string,
  testName: string,
  totalTestsForFunction = 1
) {
  let subprogram: TreeItem;
  const vcastTestingViewContent = await getViewContent("Testing");

  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand();
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram) {
      await browser.waitUntil(
        async () =>
          ((await getTestHandle(
            subprogram,
            functionName,
            testName,
            totalTestsForFunction
          )) as CustomTreeItem) === undefined,
        {
          timeout: 20_000,
          interval: 2000,
          timeoutMsg:
            "Checking that the test disappeared from the test tree timed out",
        }
      );

      break;
    }
  }

  if (!subprogram) {
    throw `Subprogram ${unitName} not found`;
  }
}

export async function generateAllTestsForUnit(
  unitName: string,
  testGenMethod: string
) {
  let workbench = await browser.getWorkbench();
  let bottomBar = workbench.getBottomBar();
  await bottomBar.toggle(true);
  const outputView = await bottomBar.openOutputView();
  const menuItemLabel = `Insert ${testGenMethod} Tests`;
  let subprogram: TreeItem;
  const vcastTestingViewContent = await getViewContent("Testing");
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand();
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram) {
      const contextMenu = await subprogram.openContextMenu();
      await contextMenu.select("VectorCAST");
      await (await $(`aria/${menuItemLabel}`)).click();

      break;
    }
  }

  if (!subprogram) {
    throw `Subprogram ${unitName} not found`;
  }
  await browser.waitUntil(
    async () =>
      (await outputView.getText())
        .toString()
        .includes("Script loaded successfully"),
    { timeout: TIMEOUT }
  );
  await browser.waitUntil(
    async () =>
      (await outputView.getText())
        .toString()
        .includes("Processing environment data for"),
    { timeout: TIMEOUT }
  );
}

export async function generateAllTestsForFunction(
  unitName: string,
  functionName: string,
  testGenMethod: string
) {
  let workbench = await browser.getWorkbench();
  let bottomBar = workbench.getBottomBar();
  await bottomBar.toggle(true);
  const outputView = await bottomBar.openOutputView();
  const menuItemLabel = `Insert ${testGenMethod} Tests`;
  let subprogram: TreeItem;
  const vcastTestingViewContent = await getViewContent("Testing");
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand();
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram) {
      const functionNode = await findSubprogramMethod(subprogram, functionName);

      const contextMenu = await functionNode.openContextMenu();
      await contextMenu.select("VectorCAST");
      await (await $(`aria/${menuItemLabel}`)).click();

      break;
    }
  }

  if (!subprogram) {
    throw `Subprogram ${unitName} not found`;
  }
  await browser.waitUntil(
    async () =>
      (await outputView.getText())
        .toString()
        .includes("Script loaded successfully"),
    { timeout: TIMEOUT }
  );
  await browser.waitUntil(
    async () =>
      (await outputView.getText())
        .toString()
        .includes("Processing environment data for"),
    { timeout: TIMEOUT }
  );
}

export async function deleteAllTestsForUnit(
  unitName: string,
  testGenMethod: string
) {
  const menuItemLabel = `Insert ${testGenMethod} Tests`;
  let subprogram: TreeItem;
  const vcastTestingViewContent = await getViewContent("Testing");
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand();
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram) {
      const menuItemLabel = "Delete Tests";
      const contextMenu = await subprogram.openContextMenu();
      await contextMenu.select("VectorCAST");
      await (await $(`aria/${menuItemLabel}`)).click();

      const vcastNotificationSourceElement = await $(
        "aria/VectorCAST Test Explorer (Extension)"
      );
      const vcastNotification = await vcastNotificationSourceElement.$("..");
      await (await vcastNotification.$("aria/Delete")).click();

      break;
    }
  }

  if (!subprogram) {
    throw `Subprogram ${unitName} not found`;
  }
}

export async function deleteAllTestsForFunction(
  unitName: string,
  functionName: string,
  testGenMethod: string
) {
  const menuItemLabel = `Insert ${testGenMethod} Tests`;
  let subprogram: TreeItem;
  const vcastTestingViewContent = await getViewContent("Testing");
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand();
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram) {
      const functionNode = await findSubprogramMethod(subprogram, functionName);
      const menuItemLabel = "Delete Tests";
      const contextMenu = await functionNode.openContextMenu();
      await contextMenu.select("VectorCAST");
      await (await $(`aria/${menuItemLabel}`)).click();

      const vcastNotificationSourceElement = await $(
        "aria/VectorCAST Test Explorer (Extension)"
      );
      const vcastNotification = await vcastNotificationSourceElement.$("..");
      await (await vcastNotification.$("aria/Delete")).click();

      break;
    }
  }

  if (!subprogram) {
    throw `Subprogram ${unitName} not found`;
  }
}

export async function validateGeneratedTestsForUnit(
  envName: string,
  unitName: string,
  testGenMethod: string
) {
  const allExpectedTests = await getAllExpectedTests(testGenMethod);
  const expectedUnitInfo = await getExpectedUnitInfo(
    allExpectedTests,
    envName,
    unitName
  );
  const vcastTestingViewContent = await getViewContent("Testing");

  for (const [functionName, tests] of Object.entries(expectedUnitInfo)) {
    for (const [testName, expectedTestCode] of Object.entries(tests)) {
      let subprogram: TreeItem;
      let testHandle: TreeItem;
      for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
        subprogram = await findSubprogram(unitName, vcastTestingViewSection);
        if (subprogram) {
          await subprogram.expand();

          testHandle = await getTestHandle(
            subprogram,
            functionName,
            testName,
            Object.entries(tests).length
          );
          if (testHandle) {
            await validateGeneratedTestScriptContent(
              testHandle,
              expectedTestCode.toString(),
              envName
            );
            break;
          } else {
            throw `Test handle not found for ${envName}:${unitName}:${functionName}:${testName}`;
          }
        }
      }

      if (!subprogram) {
        throw `Subprogram ${unitName} not found`;
      }
    }
  }
}

export async function validateGeneratedTestsForFunction(
  envName: string,
  unitName: string,
  functionName: string,
  testGenMethod: string
) {
  const allExpectedTests = await getAllExpectedTests(testGenMethod);
  const expectedFunctionInfo = await getExpectedFunctionInfo(
    allExpectedTests,
    envName,
    unitName,
    functionName
  );
  const vcastTestingViewContent = await getViewContent("Testing");

  for (const [testName, expectedTestCode] of Object.entries(
    expectedFunctionInfo
  )) {
    let subprogram: TreeItem;
    let testHandle: TreeItem;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded))
        await vcastTestingViewSection.expand();
      subprogram = await findSubprogram(unitName, vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          functionName,
          testName,
          Object.entries(expectedFunctionInfo).length
        );
        if (testHandle) {
          await validateGeneratedTestScriptContent(
            testHandle,
            expectedTestCode.toString(),
            envName
          );
          break;
        } else {
          throw `Test handle not found for ${functionName}:${testName}`;
        }
      }
    }

    if (!subprogram) {
      throw `Subprogram ${unitName} not found`;
    }
  }
}

export async function assertTestsDeleted(
  envName: string,
  testName = "all"
): Promise<void> {
  const areTestsDeletedCmd = `cd test/vcastTutorial/cpp/unitTests && ${process.env.VECTORCAST_DIR}/clicast -e ${envName} test script create output.tst`;

  {
    const { stdout, stderr } = await promisifiedExec(areTestsDeletedCmd);
    if (stderr) {
      console.log(stderr);
      throw `Error when running ${areTestsDeletedCmd}`;
    } else {
      console.log(stdout);
      const fs = require("node:fs").promises;
      console.log(
        (
          await fs.readFile("test/vcastTutorial/cpp/unitTests/output.tst")
        ).toString()
      );
      // If we are expecting no tests at all in the environment
      if (testName === "all") {
        expect(
          (
            await fs.readFile("test/vcastTutorial/cpp/unitTests/output.tst")
          ).toString()
        ).not.toContain("TEST.NAME");
      } else {
        expect(
          (
            await fs.readFile("test/vcastTutorial/cpp/unitTests/output.tst")
          ).toString()
        ).not.toContain(testName);
      }
    }
  }
}

/**
 * Selects an item from the content assist dropdown.
 *
 * Normalizes the provided item string, searches the content assist
 * items for a match, and selects the matching item.
 *
 * @param contentAssist The content assist object containing autocompletion items.
 * @param item The label of the item to be selected.
 * @throws Error if the specified item is not found.
 */
export async function selectItem(contentAssist: ContentAssist, item: string) {
  // Replace newline special characters in the input item string
  const normalizedItem = normalizeContentAssistString(item);

  // Get all content assist items
  const items: ContentAssistItem[] = await contentAssist.getItems();

  // Find the index of the item that matches the processed input string
  const itemIndex = (
    await Promise.all(
      items.map(async (assistItem) => {
        const label = await assistItem.getLabel();
        return normalizeContentAssistString(label);
      })
    )
  ).findIndex((normalizedLabel) => normalizedLabel === normalizedItem);

  if (itemIndex === -1) {
    console.log(`Content assist item ${item} not found`);
    return undefined;
  }

  // Navigate to the desired item using arrow keys
  for (let i = 0; i < itemIndex; i++) {
    await browser.keys("ArrowDown");
  }

  // Select the item
  await browser.keys("Enter");

  return items[itemIndex];
}

/**
 * Normalizes a VS Code content assist string.
 *
 * Replaces encoded newline characters ("⏎") with actual newlines,
 * collapses multiple spaces into one, and trims excess whitespace.
 *
 * @param content The string to be normalized.
 * @returns The cleaned and normalized string.
 */
export function normalizeContentAssistString(content: string): string {
  return content.replace(/⏎/g, "\n").replace(/\s+/g, " ").trim();
}

/**
 * Checks whether specific strings are contained in the Test Results message pane.
 *
 * This function opens the Test Results pane and searches the HTML document to verify
 * if all the strings from the logArray are present in the pane.
 *
 * @param {string[]} logArray - An array of strings that are expected to be found in the Test Results message pane.
 */
export async function checkForLogsInTestResults(logArray: string[]) {
  // This brings up the command Test Results: Focus on Test Results View
  // We need to open the Test Results pane because otherwise the logs are not found.
  await browser.keys([Key.Control, Key.Shift, "p"]);
  for (const character of "Test Results: Focus") {
    await browser.keys(character);
  }
  await browser.keys(Key.Enter);

  // If a log is not present, this will timeout
  for (let log of logArray) {
    await $(`aria/${log}`);
  }
}

/**
 * Function to read the last 'lineNumber' lines of the log file and check if the stringArray elements are present
 * @param lineNumber Amount of line numbers to look at starting from the end of the log file
 * @param stringArray List of strings that need to be contained withing last |lineNNumber|
 * @returns true, if all strings are found, else false
 */
export async function checkIfRequestInLogs(
  lineNumber: number,
  stringArray: string[]
): Promise<boolean> {
  const workspaceFolderName = "vcastTutorial";

  // Construct the full path to the log file
  const workspaceRootPath = process.cwd();
  const logFilePath = path.join(
    workspaceRootPath,
    "test",
    workspaceFolderName,
    "vcastDataServer.log"
  );

  // Read the log file
  const logData = fs.readFileSync(logFilePath, "utf-8");

  // Split the log into lines and filter out empty ones
  const logLines = logData.split("\n").filter((line) => line.trim() !== "");

  // Get the last 'lineNumber' lines from the file
  const lastLines = logLines.slice(-lineNumber);

  // Check if all strings in the array are present in the last lines
  let allStringsFound = true;

  console.log("Lines looked at in the log:");
  console.log(lastLines);

  stringArray.forEach((str) => {
    const isFound = lastLines.some((line) => line.includes(str));
    if (!isFound) {
      console.log(`String not found: "${str}"`);
      allStringsFound = false;
    }
  });

  return allStringsFound; // Return true if all strings are found, otherwise false
}

/**
 * Returns the last line of the outputview text.
 * @param bottomBar vscode bottom bar element
 * @returns The last line of the outputview
 */
export async function getLastLineOfOutputView(bottomBar: BottomBarPanel) {
  const outputView = await bottomBar.openOutputView();
  const text = await outputView.getText();
  const lines = text.toString().split("\n");
  return lines[lines.length - 1];
}

/**
 * Turns the Data Server on or off by clicking on the vDataServer button
 * @param turnOn - true to turn on the server, false to turn it off
 */
export async function toggleDataServer(turnOn: boolean) {
  let workbench = await browser.getWorkbench();
  let statusBar = workbench.getStatusBar();

  if (turnOn) {
    // Be sure that vDataServer On button is shown
    await browser.waitUntil(
      async () => (await statusBar.getItems()).includes("vDataServer Off"),
      { timeout: TIMEOUT }
    );

    await (await statusBar.getItem("vDataServer Off")).click();

    // Be sure that now the vDataServer On button is shown
    await browser.waitUntil(
      async () => (await statusBar.getItems()).includes("vDataServer On"),
      { timeout: TIMEOUT }
    );
  } else {
    // Be sure that vDataServer On button is shown
    await browser.waitUntil(
      async () => (await statusBar.getItems()).includes("vDataServer On"),
      { timeout: TIMEOUT }
    );

    await (await statusBar.getItem("vDataServer On")).click();

    // Be sure that now the vDataServer Off button is shown
    await browser.waitUntil(
      async () => (await statusBar.getItems()).includes("vDataServer Off"),
      { timeout: TIMEOUT }
    );
  }
}

/**
 * Checks if an element with the specified ARIA label text exists in the DOM.
 * Using an expect combined with .toExist() or .toBeDisplayed() here does not work,
 * so we have to work around it
 *
 * @param {string} searchString - The ARIA label text to search for.
 * @returns {Promise<boolean>} - Returns true if the element exists, otherwise false.
 */
export async function checkElementExistsInHTML(searchString: string) {
  try {
    // This either returns true or times out if the element does not exist.
    await $(`aria/${searchString}`);
    return true;
  } catch (error) {
    // If it times out or another error occurs, throw an error.
    throw new Error(
      `Element with ARIA label "${searchString}" does not exist or timed out.`
    );
  }
}

/**
 * Checks for a specific gutter icon on a specific line in a file and generates a report if specified.
 * @param line Line where to look at.
 * @param unitFileName File / Unit where to look at.
 * @param icon Icon that should be in the gutter.
 * @param moveCursor In case the line is not visible (>40), move the cursor to the line.
 * @param generateReport Flag if we want to generate the MCDC report or only check for the gutter icon.
 */
export async function checkForGutterAndGenerateReport(
  line: number,
  unitFileName: string,
  icon: string,
  moveCursor: boolean,
  generateReport: boolean
) {
  const workbench = await browser.getWorkbench();
  const activityBar = workbench.getActivityBar();
  const explorerView = await activityBar.getViewControl("Explorer");
  await explorerView?.openView();

  const workspaceFolderSection =
    await expandWorkspaceFolderSectionInExplorer("vcastTutorial");

  // Need to check if cpp was already selected
  // --> otherwise we close it again and we can not find manager.cpp
  let managerCpp = await workspaceFolderSection.findItem(unitFileName);
  if (!managerCpp) {
    const cppFolder = workspaceFolderSection.findItem("cpp");
    await (await cppFolder).select();
    managerCpp = await workspaceFolderSection.findItem(unitFileName);
  }
  // Check if the file is already open in the editor
  const editorView = workbench.getEditorView();
  // List of open editor titles
  const openEditors = await editorView.getOpenEditorTitles();
  const isFileOpen = openEditors.includes(unitFileName);

  if (!isFileOpen) {
    // Select file from the explorer if not already open
    await managerCpp.select();
  }

  const tab = (await editorView.openEditor(unitFileName)) as TextEditor;

  // If the line is not visible in the first place (>40) we need to scroll down
  if (moveCursor) {
    await tab.moveCursor(line, 1);
  }

  const lineNumberElement = await $(`.line-numbers=${line}`);
  const flaskElement = await (
    await lineNumberElement.parentElement()
  ).$(".cgmr.codicon");
  const backgroundImageCSS =
    await flaskElement.getCSSProperty("background-image");
  const backgroundImageURL = backgroundImageCSS.value;
  const BEAKER = `/${icon}`;
  expect(backgroundImageURL.includes(BEAKER)).toBe(true);

  // Only if we want to generate the report and not only check the gutter icon
  if (generateReport) {
    await flaskElement.click({ button: 2 });
    await (await $("aria/VectorCAST MC/DC Report")).click();
  }
}

/**
 * Rebuilds env directly from the Testing pane.
 * @param envName Name of environment.
 */
export async function rebuildEnvironmentFromTestingPane(envName: string) {
  const vcastTestingViewContent = await getViewContent("Testing");
  const env = `${envName}`;

  console.log("Re-Building Environment from Test Explorer");
  // Flask --> Right-click on env --> Re-Build environment
  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();

      const subprogramGroup = visibleItem as CustomTreeItem;
      if ((await subprogramGroup.getTooltip()).includes(env)) {
        await subprogramGroup.expand();
        const menuItemLabel = "Re-Build Environment";
        const contextMenu = await subprogramGroup.openContextMenu();
        await contextMenu.select("VectorCAST");
        await (await $(`aria/${menuItemLabel}`)).click();
        break;
      }
    }
  }
}

/**
 * Executes a context menu action on a tree node.
 *
 * @param level - The level of the node (e.g. 0 for project, 1 for compiler, etc.).
 * @param nodeName - The text label of the node to target.
 * @param vectorCASTSubMenu - If true, opens the "VectorCAST" submenu before selecting the item.
 * @param contextMenuItemName - The name of the context menu item to click.
 */
export async function executeContextMenuAction(
  level: number,
  nodeName: string,
  vectorCASTSubMenu: boolean,
  contextMenuItemName: string
): Promise<void> {
  // Find the target tree node.
  const targetNode: TreeItem = await retryFindTreeNode(level, nodeName);
  if (!targetNode) {
    throw new Error(`Node "${nodeName}" not found at level ${level}`);
  }

  // Right-click on the target node by opening its context menu.
  const contextMenu = await targetNode.openContextMenu();

  if (vectorCASTSubMenu) {
    // First, select the "VectorCAST" submenu.
    await contextMenu.select("VectorCAST");
  }
  const menuElement = await $(`aria/${contextMenuItemName}`);
  await menuElement.click();
}

async function retryFindTreeNode(
  level: number,
  nodeName: string,
  retries = 3,
  delayMs = 500
): Promise<TreeItem | undefined> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const node = await findTreeNodeAtLevel(level, nodeName);
    if (node) return node;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return undefined;
}

/**
 * Recursively finds a tree node at the given level with the provided text label.
 *
 * @param level - The depth level (0 = first level under "Test Explorer").
 * @param nodeName - The text label to match.
 * @param nodes - (Optional) The nodes to search; if not provided, search starts from the "Test Explorer" section.
 * @returns The matching tree node, or undefined if not found.
 */
export async function findTreeNodeAtLevel(
  level: number,
  nodeName: string,
  nodes?: any[]
): Promise<TreeItem | undefined> {
  // Step 1: bootstrap from the Test Explorer
  if (!nodes) {
    const view = await getViewContent("Testing");
    const sections = await view.getSections();
    let testSection;
    for (const s of sections) {
      if ((await s.getTitle()).trim() === "Test Explorer") {
        testSection = s;
        break;
      }
    }
    if (!testSection) throw new Error("Test Explorer section not found");
    nodes = await testSection.getVisibleItems();
  }

  // Step 2: if we're at the target level, scan for a matching name
  if (level === 0) {
    for (const node of nodes) {
      const text = (await node.elem.getText()).trim();
      if (text === nodeName) {
        return node;
      }
    }
    return undefined;
  }

  // Step 3: otherwise, recurse into each node's children
  for (const node of nodes) {
    if (!(await node.isExpanded())) {
      await node.expand();
      // give the UI a moment to populate children
      await new Promise((r) => setTimeout(r, 100));
    }
    const children = await node.getChildren();
    // **explicitly return** the recursive call if it finds something
    const found = await findTreeNodeAtLevel(level - 1, nodeName, children);
    if (found !== undefined) {
      return found;
    }
  }

  // nothing found anywhere
  return undefined;
}

export async function insertStringToInput(
  stringToInsert: string,
  divName: string
) {
  // Get the workbench and open the webview
  const workbench = await browser.getWorkbench();
  workbench.getEditorView();

  // Retrieve all webviews and check the number of webviews open
  const webviews = await workbench.getAllWebviews();
  expect(webviews).toHaveLength(1); // Assumes only one webview is open
  const webview = webviews[0];

  // Open the webview
  await webview.open();

  // Wait for the input element to be available by its ARIA label
  const inputElement = await $(`aria/${divName}`);

  // Check if the element exists before proceeding
  if (!inputElement) {
    console.error(`Input element with ARIA label '${divName}' not found.`);
    return;
  }

  // Insert the string into the input element
  await inputElement.setValue(stringToInsert);
  console.log(
    `Inserted "${stringToInsert}" into input with ARIA label "${divName}".`
  );
}

/**
 * Inserts a string into an input field. Basically the same like insertStringToInput, but for the autocompletion
 * input field when creating a new compiler, we need a different logic.
 * @param stringToInsert Value for the input field
 * @param ariaLabel Label of the element to find it
 * @param shouldTabToCreate Boolean to controll if it should tab its way to the correct button
 * @returns
 */
export async function insertStringIntoAutocompletionInput(
  stringToInsert: string,
  ariaLabel: string,
  shouldTabToCreate: boolean = false
): Promise<boolean> {
  // open webview (same flow you already have)
  const workbench = await browser.getWorkbench();
  workbench.getEditorView();

  console.log("0");

  const webviews = await workbench.getAllWebviews();
  if (webviews.length !== 1) {
    console.error(`Expected 1 webview but found ${webviews.length}`);
    return false;
  }
  const webview = webviews[0];
  await webview.open();

  console.log("1");

  // locate the container/input by aria
  const selector = `div[aria-label="${ariaLabel}"], [aria-label="${ariaLabel}"], div[aria-labelledby="${ariaLabel}"], [aria-labelledby="${ariaLabel}"]`;
  const candidate = await $(selector);
  try {
    await candidate.waitForExist({ timeout: 5000 });
  } catch {
    console.error(`No element found for aria label "${ariaLabel}"`);
    return false;
  }

  console.log("2");

  // pick the nested input or the element itself
  let target = candidate;
  const tag = await target.getTagName().catch(() => null);
  if (!tag || !["input", "textarea"].includes(tag.toLowerCase())) {
    const nested = await candidate.$(
      'input, textarea, [contenteditable="true"], [contenteditable]'
    );
    if (await nested.isExisting()) {
      target = nested;
    } else {
      const inputByAttr = await $(
        `input[aria-label="${ariaLabel}"], textarea[aria-label="${ariaLabel}"]`
      );
      if (await inputByAttr.isExisting()) {
        console.log("3");
        target = inputByAttr;
      } else {
        console.error(`No editable found for aria "${ariaLabel}"`);
        return false;
      }
    }
  }

  // focus + clear + set
  try {
    await target.scrollIntoView();
    await target.click();
    if (typeof (target as any).clearValue === "function") {
      await (target as any).clearValue();
    } else {
      await browser.keys(["Control", "a"]);
      await browser.keys(["Backspace"]);
    }
    await target.setValue(stringToInsert);
    console.log(`Inserted "${stringToInsert}" into "${ariaLabel}"`);
  } catch (err) {
    console.error("Failed to set value on target:", err);
    return false;
  }

  if (shouldTabToCreate) {
    await browser.keys(["Tab"]);
    await browser.keys(["Tab"]);
    await browser.keys(["Enter"]);
    return true;
  } else {
    // Dismiss suggestions / blur
    try {
      await browser.keys(["Escape"]);
      await browser.pause(80);
      await browser.keys(["Tab"]);
      await browser.pause(80);

      // click a safe element inside the webview (projectNameDisplay) to ensure dropdown closed
      await browser.execute(() => {
        console.log("7");
        const safe =
          document.getElementById("projectNameDisplay") || document.body;
        if (safe) {
          safe.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          safe.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          safe.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      });
      await browser.pause(120);

      // wait for suggestions to collapse (best-effort)
      const suggestions = await $("ul.suggestions");
      console.log("7");
      if (await suggestions.isExisting()) {
        try {
          await suggestions.waitUntil(
            async function () {
              const html = await this.getHTML(false);
              return !/\<li\b/.test(html);
            },
            { timeout: 1200 }
          );
        } catch {}
      }
    } catch (dismissErr) {
      console.warn("Error while dismissing suggestions:", dismissErr);
    }

    try {
      await browser.executeWorkbench(() => {
        const host = document.querySelector(
          ".monaco-workbench"
        ) as HTMLElement | null;
        if (host) {
          host.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          host.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          host.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      });
    } catch (e) {
      console.warn(
        "Unable to re-focus workbench after webview interaction:",
        e
      );
      return false;
    }
  }

  await browser.pause(80);
  return true;
}

export async function clickButtonBasedOnAriaLabel(ariaLabel: string) {
  // Get the workbench and open the webview
  const workbench = await browser.getWorkbench();

  // Retrieve all webviews and check the number of webviews open
  const webviews = await workbench.getAllWebviews();
  expect(webviews).toHaveLength(1); // Assumes only one webview is open
  const webview = webviews[0];

  // Open the webview
  await webview.open();

  // Wait for the input element to be available by its ARIA label
  const button = await $(`aria/${ariaLabel}`);

  // Check if the element exists before proceeding
  if (!button) {
    console.error(`Input element with ARIA label '${ariaLabel}' not found.`);
    return;
  }

  await button.click();
}

// Helper: retrieve node text (from CustomTreeItem or ViewSection).
export async function getNodeText(node: any): Promise<string> {
  if ("elem" in node && node.elem && typeof node.elem.getText === "function") {
    return (await node.elem.getText()).trim();
  }
  if (typeof node.getTitle === "function") {
    return (await node.getTitle()).trim();
  }
  throw new Error("Unknown node type");
}

// Helper: retrieve texts from an array of nodes.
export async function getTexts(nodes: any[]): Promise<string[]> {
  const texts: string[] = [];
  for (const node of nodes) {
    texts.push(await getNodeText(node));
  }
  return texts;
}

/**
 * Waits until there is at least one line in the outputView
 * that both contains `prefix` and ends with `/${suffix}`.
 */
export async function waitForEnvSuffix(
  outputView: OutputView,
  env: string,
  timeout = TIMEOUT,
  interval = 500
) {
  await browser.waitUntil(
    async () => {
      const outputText = (await outputView.getText()).toString();
      return (
        outputText.includes("Processing environment data for:") &&
        outputText.includes(env)
      );
    },
    {
      timeout,
      interval,
      timeoutMsg: `Timed out waiting for "Processing environment data for:" and "/${env}"`,
    }
  );
}
