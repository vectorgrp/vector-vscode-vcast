import {
  TextEditor,
  CustomTreeItem,
  ViewSection,
  ViewItem,
  TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";

export async function updateTestID() {
  let testIDEnvVar = process.env["E2E_TEST_ID"];
  if (testIDEnvVar) {
    let testID = parseInt(testIDEnvVar) + 1;
    process.env["E2E_TEST_ID"] = testID.toString();
  }
}
export async function getGeneratedTooltipTextAt(
  line: number,
  column: number,
  tab: TextEditor,
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
  workspaceName: string,
) {
  const workbench = await browser.getWorkbench();
  const activityBar = workbench.getActivityBar();
  const explorerView = await activityBar.getViewControl("Explorer");
  const explorerSideBarView = await explorerView?.openView();

  const workspaceFolderSection = await explorerSideBarView
    .getContent()
    .getSection(workspaceName.toUpperCase());
  console.log(await workspaceFolderSection.getTitle());
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
  console.log(`Clicking on${buttonLabel} button in Testing view`);

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

export async function findSubprogram(
  subprogramName: string,
  viewSection: ViewSection,
) {
  await viewSection.expand();
  for (const visibleItem of await viewSection.getVisibleItems()) {
    await visibleItem.select();

    const subprogramGroup = visibleItem as CustomTreeItem;
    expandAllSubprogramsFor(subprogramGroup);

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
  expectedMethodName: string,
) {
  await browser.waitUntil(
    async () => (await subprogram.getChildren()).length >= 1,
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
  totalNumOfTestsForMethod: number,
) {
  const customSubprogramMethod = await findSubprogramMethod(
    subprogram,
    expectedMethodName,
  );
  if (!customSubprogramMethod.isExpanded()) {
    await customSubprogramMethod.select();
  }
  console.log(`Waiting until ${expectedTestName} appears in the test tree`);
  await browser.waitUntil(
    async () =>
      (await customSubprogramMethod.getChildren()).length ===
      totalNumOfTestsForMethod,
  );

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
  const contextMenu = await (
    subprogramMethod as CustomTreeItem
  ).openContextMenu();
  await contextMenu.select("VectorCAST");
  // for some reason, it does not want to click on New Test Script
  // when given as an argument in select
  // so doing it manually, this slows things down
  const menuElem = await $("aria/New Test Script");
  await menuElem.click();

  const workbench = await browser.getWorkbench();
  const editorView = workbench.getEditorView();
  await browser.waitUntil(
    async () =>
      (await (await editorView.getActiveTab()).getTitle()) ===
      "vcast-template.tst",
  );
}

export async function deleteTest(testHandle: CustomTreeItem) {
  const contextMenu = await (testHandle as CustomTreeItem).openContextMenu();
  await contextMenu.select("VectorCAST");
  // for some reason, it does not want to click on Delete Test
  // when given as an argument in select

  const menuElem = await $("aria/Delete Test");
  await menuElem.click();
}

export async function editTestScriptFor(
  subprogramMethod: CustomTreeItem,
  testEnvironmentName: string,
) {
  const contextMenu = await (
    subprogramMethod as CustomTreeItem
  ).openContextMenu();
  await contextMenu.select("VectorCAST");
  // for some reason, it does not want to click on New Test Script
  // when given as an argument in select
  // so doing it manually, this slows things down
  const menuElem = await $("aria/Edit Test Script");
  await menuElem.click();

  const workbench = await browser.getWorkbench();
  const editorView = workbench.getEditorView();
  await browser.waitUntil(
    async () =>
      (await (await editorView.getActiveTab()).getTitle()) ===
      testEnvironmentName + ".tst",
  );
}

export enum testGenMethod {
  BasisPath = "Basis Path",
  ATG = "ATG"
};

export async function generateAllTestsForEnv(envName:string, testGenMethod:string){
  const menuItemLabel = `Insert ${testGenMethod} Tests`
  const vcastTestingViewContent = await getViewContent("Testing");
  
  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();
  
      const subprogramGroup = visibleItem as CustomTreeItem;
      await expandAllSubprogramsFor(subprogramGroup);
      if ((await subprogramGroup.getTooltip()).includes("cpp/unitTests/DATABASE-MANAGER")){
        const ctxMenu = await subprogramGroup.openContextMenu()
        await ctxMenu.select("VectorCAST")
        await (await $(`aria/${menuItemLabel}`)).click();

        const workbench = await browser.getWorkbench();
        const bottomBar = workbench.getBottomBar()
        await browser.waitUntil(async () =>
          (await (await bottomBar.openOutputView()).getText()).includes(
            "test explorer  [info]      Summary of automatic test case generation:",
          ),
        );

        await browser.waitUntil(async () =>
          (await (await bottomBar.openOutputView()).getText()).includes(
            "test explorer  [info]  Script loaded successfully ...",
          ),
        );

        break
      }
    }

  }
}

export async function validateGeneratedTest(testHandle:TreeItem, epxectedTestCode: string){
  await testHandle.select();
  const ctxMenu = await testHandle.openContextMenu()
  await browser.takeScreenshot()
  await browser.saveScreenshot("context menu.png")
  await ctxMenu.select("VectorCAST");
  const menuElem = await $("aria/Edit Test Script");
  await menuElem.click();

  const workbench = await browser.getWorkbench();
  const editorView = workbench.getEditorView();
  await browser.waitUntil(
    async () =>
      (await (await editorView.getActiveTab()).getTitle()) ===
      "DATABASE-MANAGER.tst",
  );
  const tab = (await editorView.openEditor(
    "DATABASE-MANAGER.tst",
  )) as TextEditor;
  
  const fullGenTstScript = await tab.getText();
  await editorView.closeAllEditors()
  const idx = fullGenTstScript.indexOf(epxectedTestCode)

  if (idx > -1){
    expect(fullGenTstScript.substring(idx).trimEnd()).toBe(epxectedTestCode.trimEnd())
  }
  else{
    // we want to see the diff here
    expect(fullGenTstScript.trimEnd()).toBe(epxectedTestCode.trimEnd())
  }
}