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
    validateGeneratedTestScriptContent,
    deleteAllTestsForEnv,
    validateTestDeletionForEnv,
    generateAndValidateAllTestsFor,
    generateFlaskIconTestsFor,
    validateGeneratedTest,
    deleteGeneratedTest,
    validateSingleTestDeletion,
    multiselectDeletion,
    vcastTest
  } from "../test_utils/vcast_utils";
  
  import { exec } from "child_process";
  import { promisify } from "node:util";
  import fs from 'fs/promises'

  import expectedBasisPathTests from "../basis_path_tests.json"
import { env } from "process";
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
  
    it("should correctly generate all BASIS PATH tests for the environment", async () => {
      await updateTestID();
      const envName = "cpp/unitTests/DATABASE-MANAGER"
      await generateAndValidateAllTestsFor(envName,testGenMethod.BasisPath)
  
    });

    it("should correctly perform multiselect delete on BASIS PATH tests", async () => {
      await updateTestID();
      
      const envName = "cpp/unitTests/DATABASE-MANAGER"
      const test1: vcastTest = {
        envName:envName,
        unitName:"database",
        functionName:"DataBase::GetTableRecord",
        testName:"BASIS-PATH-001",
        numTestsForFunction:1
      }
      const test2: vcastTest = {
        envName:envName,
        unitName:"database",
        functionName:"DataBase::UpdateTableRecord",
        testName:"BASIS-PATH-001",
        numTestsForFunction:1
      }

      const test3: vcastTest = {
        envName:envName,
        unitName:"manager",
        functionName:"Manager::ClearTable",
        testName:"BASIS-PATH-001",
        numTestsForFunction:1
      }
      let vcastTests: vcastTest[] = [test1, test2, test3]

      await multiselectDeletion(vcastTests)

      for (const test of vcastTests) {
        await validateSingleTestDeletion(test.unitName,test.functionName, test.testName, test.numTestsForFunction)

      }

    });

    it("should correctly delete all BASIS PATH tests for the environment", async () => {
      await updateTestID();
      
      const envName = "cpp/unitTests/DATABASE-MANAGER"
      await deleteAllTestsForEnv(envName);
      await validateTestDeletionForEnv(envName);
      
    });

    it("should correctly generate all ATG tests for the environment", async () => {
      await updateTestID();
      const envName = "cpp/unitTests/DATABASE-MANAGER"
      if (process.env["BASIS_PATH_ONLY"] === "FALSE"){
        
        await generateAndValidateAllTestsFor(envName,testGenMethod.ATG)
      }
      else{
        console.log("Skipping ATG tests")
      }
      
    });

    it("should correctly delete all ATG tests for the environment", async () => {
      await updateTestID();

      if (process.env["BASIS_PATH_ONLY"] === "FALSE"){
        const envName = "cpp/unitTests/DATABASE-MANAGER"
        await deleteAllTestsForEnv(envName);
        await validateTestDeletionForEnv(envName);
      }
      
    });

    it("should correctly generate BASIS PATH tests by clicking on flask+ icon", async () => {
      await updateTestID();
      await generateFlaskIconTestsFor(10, testGenMethod.BasisPath, "database.cpp")
      await validateGeneratedTest(testGenMethod.BasisPath,"cpp/unitTests/DATABASE-MANAGER","database","DataBase::GetTableRecord","BASIS-PATH-001", 1)
      
    });

    it("should correctly delete BASIS PATH tests generated by clicking on flask+ icon", async () => {
      await updateTestID();
      await deleteGeneratedTest("database","DataBase::GetTableRecord","BASIS-PATH-001", 1)
      await validateSingleTestDeletion("database","DataBase::GetTableRecord","BASIS-PATH-001", 1)
    });

    it("should correctly generate ATG tests by clicking on flask+ icon", async () => {
      await updateTestID();
      if (process.env["BASIS_PATH_ONLY"] === "FALSE"){
        await generateFlaskIconTestsFor(10, testGenMethod.ATG, "database.cpp")
        await validateGeneratedTest(testGenMethod.ATG,"cpp/unitTests/DATABASE-MANAGER","database","DataBase::GetTableRecord","ATG-TEST-1", 1)
      }
      else{
        console.log("Skipping ATG tests")
      }
      
    });

    it("should correctly delete ATG tests generated by clicking on flask+ icon", async () => {
      await updateTestID();
      if (process.env["BASIS_PATH_ONLY"] === "FALSE"){
        await deleteGeneratedTest("database","DataBase::GetTableRecord","ATG-TEST-1", 1)
        await validateSingleTestDeletion("database","DataBase::GetTableRecord","ATG-TEST-1", 1)
      }
    });
    
  });
  