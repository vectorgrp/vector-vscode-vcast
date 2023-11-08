// test/specs/vcast.test.ts
import {
    BottomBarPanel,
    StatusBar,
    TextEditor,
    EditorView,
    CustomTreeItem,
    Workbench,
    TreeItem,
    ViewItem,
  } from "wdio-vscode-service";
  import { Key } from "webdriverio";
  import {
    releaseCtrl,
    executeCtrlClickOn,
    expandWorkspaceFolderSectionInExplorer,
    clickOnButtonInTestingHeader,
    getGeneratedTooltipTextAt,
    getViewContent,
    findSubprogram,
    getTestHandle,
    findSubprogramMethod,
    openTestScriptFor,
    editTestScriptFor,
    deleteTest,
    updateTestID,
    expandAllSubprogramsFor,
    generateAllTestsForEnv,
    testGenMethod,
    validateGeneratedTest
  } from "../test_utils/vcast_utils";
  
  import { exec } from "child_process";
  import { promisify } from "node:util";
  import fs from 'fs/promises'

  import expectedBasisPathTests from "../basis_path_tests.json"
  const promisifiedExec = promisify(exec);
  describe("vTypeCheck VS Code Extension", () => {
    let bottomBar: BottomBarPanel;
    let workbench: Workbench;
    let editorView: EditorView;
    let statusBar: StatusBar;
    const TIMEOUT = 120000;
    before(async () => {
      workbench = await browser.getWorkbench();
      // opening bottom bar and problems view before running any tests
      bottomBar = workbench.getBottomBar();
      await bottomBar.toggle(true);
      editorView = workbench.getEditorView();
      process.env["E2E_TEST_ID"] = "0";
    });
  
    it("test 1: should be able to load VS Code", async () => {
      await updateTestID();
      expect(await workbench.getTitleBar().getTitle()).toBe(
        "[Extension Development Host] vcastTutorial - Visual Studio Code",
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
      
      
      await bottomBar.toggle(true);
      const outputView = await bottomBar.openOutputView();
  
      console.log("Waiting for VectorCAST activation");
      await $("aria/VectorCAST Test Pane Initialization");
      console.log("WAITING FOR TESTING");
      await browser.waitUntil(
        async () => (await activityBar.getViewControl("Testing")) !== undefined,
        { timeout: TIMEOUT },
      );
      console.log("WAITING FOR TEST EXPLORER");
      await browser.waitUntil(async () =>
        (await outputView.getChannelNames())
          .toString()
          .includes("VectorCAST Test Explorer")
      );
      await outputView.selectChannel("VectorCAST Test Explorer")
      console.log("Channel selected")
      console.log("WAITING FOR LANGUAGE SERVER");
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes("Starting the language server"),
        { timeout: TIMEOUT },
      );
  
      const testingView = await activityBar.getViewControl("Testing");
      await testingView?.openView();
    });
  
    it("should set default config file", async () => {
      await updateTestID();
  
      const workbench = await browser.getWorkbench();
      const activityBar = workbench.getActivityBar();
      const explorerView = await activityBar.getViewControl("Explorer");
      await explorerView?.openView();
  
      const workspaceFolderSection = await expandWorkspaceFolderSectionInExplorer(
        "vcastTutorial",
      );
  
      const configFile = await workspaceFolderSection.findItem("CCAST_.CFG")
      await configFile.openContextMenu()
      await (await $("aria/Set as VectorCAST Configuration File")).click()
    });
  
    it("should create VectorCAST environment", async () => {
      await updateTestID();
  
      const workbench = await browser.getWorkbench();
      const activityBar = workbench.getActivityBar();
      const explorerView = await activityBar.getViewControl("Explorer");
      await explorerView?.openView();
  
      const workspaceFolderSection = await expandWorkspaceFolderSectionInExplorer(
        "vcastTutorial",
      );
      const cppFolder = workspaceFolderSection.findItem("cpp");
      await (await cppFolder).select();
  
      let managerCpp = await workspaceFolderSection.findItem("manager.cpp");
      let databaseCpp = await workspaceFolderSection.findItem("database.cpp");
      await executeCtrlClickOn(databaseCpp);
      await executeCtrlClickOn(managerCpp);
      await releaseCtrl();
  
      await databaseCpp.openContextMenu();
      await (await $("aria/Create VectorCAST Environment")).click();
  
      // making sure notifications are shown
      await (await $("aria/Notifications")).click();
  
      // this will timeout if VectorCAST notification does not appear, resulting in a failed test
      const vcastNotifSourceElem = await $(
        "aria/VectorCAST Test Explorer (Extension)",
      );
      const vcastNotification = await vcastNotifSourceElem.$("..");
      await (await vcastNotification.$("aria/Yes")).click();
  
      console.log(
        "Waiting for clicast and waiting for environment to get processed",
      );
      await browser.waitUntil(
        async () =>
          (await (await bottomBar.openOutputView()).getText())
            .toString()
            .includes("Environment built Successfully"),
        { timeout: TIMEOUT },
      );
  
      console.log("Finished creating vcast environment");
      await browser.takeScreenshot();
      await browser.saveScreenshot(
        "info_finished_creating_vcast_environment.png",
      );
      // clearing all notifications
      await (await $(".codicon-notifications-clear-all")).click();
    });
  
    it("should correctly generate all tests for the environment", async () => {
      await updateTestID();
      
      const envName = "cpp/unitTests/DATABASE-MANAGER"
      await generateAllTestsForEnv(envName, testGenMethod.BasisPath)
      
      const vcastTestingViewContent = await getViewContent("Testing");

      for (const [env, units] of Object.entries(expectedBasisPathTests)) {
        for (const [unitName, functions] of Object.entries(units)) {
          for (const [functionName,tests] of Object.entries(functions)) {
            for (const [testName, expectedTestCode] of Object.entries(tests)) {
              console.log(`Expected Test ${env}:${unitName}:${functionName}:${testName}`);
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
                    await validateGeneratedTest(testHandle, expectedTestCode)
                    break;
                  } else {
                    throw `Test handle not found for ${env}:${unitName}:${functionName}:${testName}`;
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
      
    });
    
  });
  