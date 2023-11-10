import {
  TextEditor,
  CustomTreeItem,
  ViewSection,
  ViewItem,
  TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import expectedBasisPathTests from "../basis_path_tests.json"
import expectedAtgTests from "../atg_tests.json"
import { TIMEOUT } from "node:dns";
import { type } from "node:os";
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
  try{
    await browser.waitUntil(
      async () =>
        (await customSubprogramMethod.getChildren()).length ===
        totalNumOfTestsForMethod,{timeout:4000, timeoutMsg:`${expectedTestName} not found`}
    );
  }
  catch (e:unknown){
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

  const menuElem = await $("aria/Delete Tests");
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
  console.log(`Menu to click is ${menuItemLabel}`)
  const vcastTestingViewContent = await getViewContent("Testing");
  
  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();
  
      const subprogramGroup = visibleItem as CustomTreeItem;
      await expandAllSubprogramsFor(subprogramGroup);
      if ((await subprogramGroup.getTooltip()).includes(envName)){
        await subprogramGroup.expand()
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

export async function validateGeneratedTestScriptContent(testHandle:TreeItem, epxectedTestCode: string){
  await testHandle.select();
  const ctxMenu = await testHandle.openContextMenu()
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

export async function deleteAllTestsForEnv(envName:string){
  const vcastTestingViewContent = await getViewContent("Testing");
  
  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();
  
      const subprogramGroup = visibleItem as CustomTreeItem;
      if ( (await subprogramGroup.getTooltip()).includes(envName)){
        await subprogramGroup.expand()
        const menuItemLabel = "Delete Tests"
        const ctxMenu = await subprogramGroup.openContextMenu()
        await ctxMenu.select("VectorCAST")
        await (await $(`aria/${menuItemLabel}`)).click();

        const vcastNotifSourceElem = await $(
          "aria/VectorCAST Test Explorer (Extension)",
        );
        const vcastNotification = await vcastNotifSourceElem.$("..");
        await (await vcastNotification.$("aria/Delete")).click();

        break
      }
      
    }

  }
}

export async function validateTestDeletionForEnv(envName:string){
  const vcastTestingViewContent = await getViewContent("Testing");
  
  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();
      
      const subprogramGroup = visibleItem as CustomTreeItem;
   
      if ((await subprogramGroup.getTooltip()).includes(envName)){
        console.log(`env: ${await subprogramGroup.getTooltip()}`)

        for (const unit of await subprogramGroup.getChildren()) {
          const unitName = await unit.getTooltip()
          console.log(`Unit: ${unitName}`)
          
          if (!(unitName.includes("Compound")) && !(unitName.includes("Initialization"))){
            for (const method of await unit.getChildren()) {
              const methodName = await method.getTooltip()
              console.log(`Method: ${methodName}`) 
              // this is flaky, it sometimes takes manager as Child element
              if (methodName.includes("::")){
                await browser.waitUntil(
                  async () =>
                    (await method.hasChildren()) === false
                ); 
              }
            }
          
          }
        }
        // getVisibleItems() literally gets the visible items, including leaves in the structure
        // important to stop the loop here, otherwise wdio starts doing random things and hangs
        break;
      }
    }

  }
}

export async function validateTestDeletionForUnit(envName:string, unitName:string){
  const vcastTestingViewContent = await getViewContent("Testing");
  
  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();
      
      const subprogramGroup = visibleItem as CustomTreeItem;
   
      if ((await subprogramGroup.getTooltip()).includes(envName)){
        console.log(`env: ${await subprogramGroup.getTooltip()}`)

        for (const unit of await subprogramGroup.getChildren()) {
          const unitNameTooltip = await unit.getTooltip()
          console.log(`Unit: ${unitNameTooltip}`)
          
          if (unitNameTooltip.includes(unitName)){
            for (const method of await unit.getChildren()) {
              const methodName = await method.getTooltip()
              console.log(`Method: ${methodName}`) 
              // this is flaky, it sometimes takes manager as Child element
              if (methodName.includes("::")){
                await browser.waitUntil(
                  async () =>
                    (await method.hasChildren()) === false
                ); 
              }
            }
          break;
          }
        }
        // getVisibleItems() literally gets the visible items, including leaves in the structure
        // important to stop the loop here, otherwise wdio starts doing random things and hangs
        break;
      }
    }

  }
}

export async function validateTestDeletionForFunction(envName:string, unitName:string, functionName:string){
  const vcastTestingViewContent = await getViewContent("Testing");
  
  for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
    
    for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
      await visibleItem.select();
      
      const subprogramGroup = visibleItem as CustomTreeItem;
   
      if ((await subprogramGroup.getTooltip()).includes(envName)){
        console.log(`env: ${await subprogramGroup.getTooltip()}`)

        for (const unit of await subprogramGroup.getChildren()) {
          const unitNameTooltip = await unit.getTooltip()
          console.log(`Unit: ${unitNameTooltip}`)
          
          if (unitNameTooltip.includes(unitName)){
            for (const method of await unit.getChildren()) {
              const methodNameTooltip = await method.getTooltip()
              console.log(`Method: ${methodNameTooltip}`) 
              // this is flaky, it sometimes takes manager as Child element
              if (methodNameTooltip.includes(functionName)){
                await browser.waitUntil(
                  async () =>
                    (await method.hasChildren()) === false
                ); 
                break;
              }
            }
          break;
          }
        }
        // getVisibleItems() literally gets the visible items, including leaves in the structure
        // important to stop the loop here, otherwise wdio starts doing random things and hangs
        break;
      }
    }

  }
}

export async function generateAndValidateAllTestsFor(envName:string, testGenMethod:string){

  await generateAllTestsForEnv(envName, testGenMethod)
      
  // const vcastTestingViewContent = await getViewContent("Testing");

  // for (const [env, units] of Object.entries(expectedBasisPathTests)) {
  //   for (const [unitName, functions] of Object.entries(units)) {
  //     for (const [functionName,tests] of Object.entries(functions)) {
  //       for (const [testName, expectedTestCode] of Object.entries(tests)) {
  //         console.log(`Expected Test ${env}:${unitName}:${functionName}:${testName}`);
  //         let subprogram: TreeItem = undefined;
  //         let testHandle: TreeItem = undefined;
  //         for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
  //           subprogram = await findSubprogram(unitName, vcastTestingViewSection);
  //           if (subprogram) {
  //             await subprogram.expand();
  //             testHandle = await getTestHandle(
  //               subprogram,
  //               functionName,
  //               testName,
  //               Object.entries(tests).length,
  //             );
  //             if (testHandle) {
  //               await validateGeneratedTestScriptContent(testHandle, expectedTestCode)
  //               break;
  //             } else {
  //               throw `Test handle not found for ${env}:${unitName}:${functionName}:${testName}`;
  //             }
  //           }
  //         }

  //         if (!subprogram) {
  //           throw `Subprogram ${unitName} not found`;
  //         }
  //       }
  //     }
      
  //   }
    
  // }
}

export async function generateFlaskIconTestsFor(line:number, testGenMethod:string, unitFileName: string){
  const workbench = await browser.getWorkbench();
  const activityBar = workbench.getActivityBar();
  const explorerView = await activityBar.getViewControl("Explorer");
  const explorerSideBarView = await explorerView?.openView();

  const workspaceFolderName = "vcastTutorial";
  const workspaceFolderSection = await explorerSideBarView
    .getContent()
    .getSection(workspaceFolderName.toUpperCase());
  console.log(await workspaceFolderSection.getTitle());
  await workspaceFolderSection.expand();

  const managerCpp = workspaceFolderSection.findItem(unitFileName);
  await (await managerCpp).select();

  const editorView = workbench.getEditorView();
  const tab = (await editorView.openEditor(unitFileName)) as TextEditor;
  
  await tab.moveCursor(line, 1);
  
  let lineNumberElement = await $(`.line-numbers=${line}`);
  let flaskElement = await (
    await lineNumberElement.parentElement()
  ).$(".cgmr.codicon");
  let backgroundImageCSS = await flaskElement.getCSSProperty(
    "background-image",
  );
  let backgroundImageURL = backgroundImageCSS.value;
  const BEAKER = "/beaker-plus"
  expect(backgroundImageURL.includes(BEAKER)).toBe(true);
  await flaskElement.click({button:2})

  await (await $("aria/VectorCAST")).click();
  await (await $(`aria/Generate ${testGenMethod} Tests`)).click();
}

export async function validateGeneratedTest(
  testGenMethod:string,
  envName:string, 
  unitName:string, 
  functionName:string, 
  testName:string, 
  totalTestsForFunction:number = 1
  ){
  let subprogram: TreeItem = undefined;
  const vcastTestingViewContent = await getViewContent("Testing");
  
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand()
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram){
      
      const testHandle = await getTestHandle(subprogram, functionName, testName, totalTestsForFunction)
      expect(testHandle).not.toBe(undefined)
      const allExpectedTests = await getAllExpectedTests(testGenMethod)
      const expectedTestCode = await getExpectedTestCode(allExpectedTests, envName,unitName,functionName, testName)
      await validateGeneratedTestScriptContent(testHandle, expectedTestCode)
      break;
    }
  }
  if (!subprogram){
    throw `Subprogram ${unitName} not found`
  }

}

export async function getExpectedTestCode(expectedTests:Object, envName:string, unitName:string, functionName:string, testName:string) {
  if (unitName == "database"){
    return expectedTests[envName].database[functionName][testName]
  }  
  if (unitName == "manager"){
    return expectedTests[envName].manager[functionName][testName]
  }
  return undefined
}

export async function getExpectedUnitInfo(expectedTests:Object, envName:string, unitName:string) {
  if (unitName == "database"){
    return expectedTests[envName].database
  }  
  if (unitName == "manager"){
    return expectedTests[envName].manager
  }
}

export async function getExpectedFunctionInfo(expectedTests:Object, envName:string, unitName:string, functionName:string) {
  if (unitName == "database"){
    return expectedTests[envName].database[functionName]
  }  
  if (unitName == "manager"){
    return expectedTests[envName].manager[functionName]
  }
}

export async function getAllExpectedTests(testGenMethodText:string) {
 if (testGenMethodText === testGenMethod.BasisPath){
  return expectedBasisPathTests
 } 
 else{
  return expectedAtgTests
 }
}


export async function deleteGeneratedTest(
  unitName:string, 
  functionName:string, 
  testName:string, 
  totalTestsForFunction:number = 1
  ){
  let subprogram: TreeItem = undefined;
  const vcastTestingViewContent = await getViewContent("Testing");
  
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand()
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram){
      
      const testHandle = await getTestHandle(subprogram, functionName, testName, totalTestsForFunction) as CustomTreeItem
      expect(testHandle).not.toBe(undefined)
      await deleteTest(testHandle)
      break;
    }
  }
  if (!subprogram){
    throw `Subprogram ${unitName} not found`
  }

}

export type vcastTest = {
  envName:string;
  unitName:string;
  functionName:string;
  testName:string;
  numTestsForFunction:number;
}


export async function multiselectDeletion(tests:vcastTest[]){
  let subprogram: TreeItem = undefined;
  const vcastTestingViewContent = await getViewContent("Testing");
  
  let testHandles: CustomTreeItem[] = []

  for (const vcastTest of tests) {
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand()
      subprogram = await findSubprogram(vcastTest.unitName, vcastTestingViewSection);
      if (subprogram){
        
        const testHandle = await getTestHandle(subprogram, vcastTest.functionName, vcastTest.testName, vcastTest.numTestsForFunction) as CustomTreeItem
        expect(testHandle).not.toBe(undefined)
        testHandles.push(testHandle)
        break;
      }
    }
    if (!subprogram){
      throw `Subprogram ${vcastTest.unitName} not found`
    }
    
  }

  for (const testHandle of testHandles) {
    await executeCtrlClickOn(testHandle)
  }
  await releaseCtrl();
  const ctxMenu = await testHandles[0].openContextMenu()
  await ctxMenu.select("VectorCAST")
  const menuElem = await $("aria/Delete Tests");
  await menuElem.click();

  const vcastNotifSourceElem = await $(
    "aria/VectorCAST Test Explorer (Extension)",
  );
  const vcastNotification = await vcastNotifSourceElem.$("..");
  await (await vcastNotification.$("aria/Delete")).click();


}

export async function validateSingleTestDeletion(
  unitName:string, 
  functionName:string, 
  testName:string, 
  totalTestsForFunction:number = 1
  ){
  let subprogram: TreeItem = undefined;
  const vcastTestingViewContent = await getViewContent("Testing");
  
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand()
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram){
      
      const testHandle = await getTestHandle(subprogram, functionName, testName, totalTestsForFunction) as CustomTreeItem
      expect(testHandle).toBe(undefined)
      break;
    }
  }
  if (!subprogram){
    throw `Subprogram ${unitName} not found`
  }

}

export async function generateAllTestsForUnit(unitName:string, testGenMethod:string){
  const menuItemLabel = `Insert ${testGenMethod} Tests`
  let subprogram: TreeItem = undefined;
  const vcastTestingViewContent = await getViewContent("Testing");
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand()
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram){
      const ctxMenu = await subprogram.openContextMenu()
      await ctxMenu.select("VectorCAST")
      await (await $(`aria/${menuItemLabel}`)).click();
      
      break;
    }
  }
  if (!subprogram){
    throw `Subprogram ${unitName} not found`
  }
}

export async function generateAllTestsForFunction(unitName:string, functionName:string, testGenMethod:string){
  const menuItemLabel = `Insert ${testGenMethod} Tests`
  let subprogram: TreeItem = undefined;
  const vcastTestingViewContent = await getViewContent("Testing");
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand()
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram){

      const functionNode = await findSubprogramMethod(subprogram,functionName)

      const ctxMenu = await functionNode.openContextMenu()
      await ctxMenu.select("VectorCAST")
      await (await $(`aria/${menuItemLabel}`)).click();
      
      break;
    }
  }
  if (!subprogram){
    throw `Subprogram ${unitName} not found`
  }
}

export async function deleteAllTestsForUnit(unitName:string, testGenMethod:string){
  const menuItemLabel = `Insert ${testGenMethod} Tests`
  let subprogram: TreeItem = undefined;
  const vcastTestingViewContent = await getViewContent("Testing");
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand()
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram){
      const menuItemLabel = "Delete Tests"
      const ctxMenu = await subprogram.openContextMenu()
      await ctxMenu.select("VectorCAST")
      await (await $(`aria/${menuItemLabel}`)).click();

      const vcastNotifSourceElem = await $(
        "aria/VectorCAST Test Explorer (Extension)",
      );
      const vcastNotification = await vcastNotifSourceElem.$("..");
      await (await vcastNotification.$("aria/Delete")).click();

      break
    }
  }
  if (!subprogram){
    throw `Subprogram ${unitName} not found`
  }
}

export async function deleteAllTestsForFunction(unitName:string, functionName:string, testGenMethod:string){
  const menuItemLabel = `Insert ${testGenMethod} Tests`
  let subprogram: TreeItem = undefined;
  const vcastTestingViewContent = await getViewContent("Testing");
  for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
    await vcastTestingViewSection.expand()
    subprogram = await findSubprogram(unitName, vcastTestingViewSection);
    if (subprogram){

      const functionNode = await findSubprogramMethod(subprogram, functionName);
      const menuItemLabel = "Delete Tests"
      const ctxMenu = await functionNode.openContextMenu();
      await ctxMenu.select("VectorCAST")
      await (await $(`aria/${menuItemLabel}`)).click();

      const vcastNotifSourceElem = await $(
        "aria/VectorCAST Test Explorer (Extension)",
      );
      const vcastNotification = await vcastNotifSourceElem.$("..");
      await (await vcastNotification.$("aria/Delete")).click();

      break;
    }
  }
  if (!subprogram){
    throw `Subprogram ${unitName} not found`
  }
}

export async function validateGeneratedTestsForUnit(envName: string, unitName: string, testGenMethod: string){
  const allExpectedTests = await getAllExpectedTests(testGenMethod)
  const expectedUnitInfo = await getExpectedUnitInfo(allExpectedTests, envName, unitName)
  const vcastTestingViewContent = await getViewContent("Testing");

  
  
  for (const [functionName,tests] of Object.entries(expectedUnitInfo)) {
    for (const [testName, expectedTestCode] of Object.entries(tests)) {
      console.log(`Expected Test ${envName}:${unitName}:${functionName}:${testName}`);
      let subprogram: TreeItem = undefined;
      let testHandle: TreeItem = undefined;
      for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
        subprogram = await findSubprogram(unitName, vcastTestingViewSection);
        if (subprogram) {
          await subprogram.expand();
          testHandle = await getTestHandle(
            subprogram,
            functionName,
            testName,
            Object.entries(tests).length,
          );
          if (testHandle) {
            await validateGeneratedTestScriptContent(testHandle, expectedTestCode.toString())
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

export async function validateGeneratedTestsForFunction(envName: string, unitName: string, functionName: string, testGenMethod: string){
  const allExpectedTests = await getAllExpectedTests(testGenMethod)
  const expectedFunctionInfo = await getExpectedFunctionInfo(allExpectedTests, envName, unitName, functionName)
  const vcastTestingViewContent = await getViewContent("Testing");

  
  for (const [testName, expectedTestCode] of Object.entries(expectedFunctionInfo)) {
    console.log(`Expected Test ${functionName}:${testName}`);
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram(unitName, vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          functionName,
          testName,
          Object.entries(expectedFunctionInfo).length,
        );
        if (testHandle) {
          await validateGeneratedTestScriptContent(testHandle, expectedTestCode.toString())
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