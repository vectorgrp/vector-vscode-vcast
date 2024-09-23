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
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import expectedBasisPathTests from "../basis_path_tests.json";
import expectedAtgTests from "../atg_tests.json";
import http from "http";
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

// Local VM takes longer and needs a higher TIMEOUT
export const TIMEOUT = 180_000;

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
      { timeout: 8000, timeoutMsg: `${expectedTestName} not found` }
    );
  } catch {
    return undefined;
  }

  for (const testHandle of await customSubprogramMethod.getChildren()) {
    if (
      (await (await (testHandle as CustomTreeItem).elem).getText()) ===
      expectedTestName
    ) {
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
}

export async function generateAllTestsForFunction(
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

      const contextMenu = await functionNode.openContextMenu();
      await contextMenu.select("VectorCAST");
      await (await $(`aria/${menuItemLabel}`)).click();

      break;
    }
  }

  if (!subprogram) {
    throw `Subprogram ${unitName} not found`;
  }
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
function normalizeContentAssistString(content: string): string {
  return content.replace(/⏎/g, "\n").replace(/\s+/g, " ").trim();
}

/**
 * Pings the server to check if it is alive.
 *
 * @param {ServerOptions} options - The HTTP request options (hostname, port, path, method).
 * @returns {Promise<boolean>} - Resolves `true` if the server responds, otherwise `false`.
 */
export async function pingServer(options: ServerOptions) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode === 200 && data.includes("clicast-path")) {
          console.log("Ping successful: Server is alive.");
          resolve(true);
        } else {
          console.log("Ping failed: Server is not responding.");
          resolve(false);
        }
      });
    });

    req.on("error", (e) => {
      console.error(`Ping request failed: ${e.message}`);
      resolve(false); // Server might be down
    });

    req.end();
  });
}

/**
 * Sends a shutdown request to the server.
 *
 * @param {ServerOptions} options - The HTTP request options (hostname, port, path, method).
 * @returns {Promise<void>} - Resolves when the shutdown request completes.
 */
export async function shutdownServer(options: any) {
  return new Promise<void>((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        console.log("Shutdown response:", data);
        resolve();
      });
    });

    req.on("error", (e) => {
      console.error(`Shutdown request failed: ${e.message}`);
      resolve();
    });

    req.end();
  });
}
