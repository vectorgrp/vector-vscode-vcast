// test/specs/vcast.test.ts
import {
  BottomBarPanel,
  TextEditor,
  EditorView,
  Workbench,
  TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  getViewContent,
  findSubprogram,
  getTestHandle,
  findSubprogramMethod,
  updateTestID,
} from "../test_utils/vcast_utils";

import { exec } from "child_process";
import { promisify } from "node:util";
const promisifiedExec = promisify(exec);
describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  const TIMEOUT = 20000;
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
    const viewControls = await activityBar.getViewControls();
    for (const viewControl of viewControls) {
      console.log(await viewControl.getTitle());
    }
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

  it("should validate turning off automatic report generation", async () => {
    await updateTestID();
    console.log("Looking for Manager::PlaceOrder in the test tree");

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const settingsEditor = await workbench.openSettings();
    await settingsEditor.findSetting(
      "vectorcastTestExplorer.showReportOnExecute",
    );
    // only one setting in search results, so the current way of clicking is correct
    await (await settingsEditor.checkboxSetting$).click();
    // The following would have been cleaner but returns un undefined setting object:
    // const setting = await settingsEditor.findSetting("vectorcastTestExplorer.showReportOnExecute");
    // expect(setting).not.toBe(undefined)
    // await setting.setValue(false)

    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "myThirdTest",
          3,
        );
        if (testHandle) {
          break;
        } else {
          throw new Error("Test handle not found for myFirstTest");
        }
      }
    }

    if (!subprogram) {
      throw new Error("Subprogram 'manager' not found");
    }

    console.log("Running myThirdTest");
    await testHandle.select();
    await (await (await testHandle.getActionButton("Run Test")).elem).click();

    await bottomBar.maximize();
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText()).includes(
          "test explorer  [info]  Status: passed",
        ),
      { timeout: TIMEOUT },
    );
    await bottomBar.restore();

    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(0);

    await workbench.openSettings();
    // only one setting in search results, so the current way of clicking is correct
    await (await settingsEditor.checkboxSetting$).click();
  });

  it("should run COMPOUND Test and check its report", async () => {
    await updateTestID();

    const vcastTestingViewContent = await getViewContent("Testing");
    console.log("Expanding all test groups");
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      await vcastTestingViewSection.expand()
      subprogram = await findSubprogram(
        "Compound Tests",
        vcastTestingViewSection,
      );
      if (subprogram) {
        await subprogram.expand();
        testHandle = await findSubprogramMethod(
          subprogram,
          "test-<<COMPOUND>>",
        );

        if (testHandle) {
          break;
        } else {
          throw new Error( "Test handle not found for Compound Test");
        }
      }
    }

    if (!subprogram) {
      throw new Error( "Subprogram 'manager' not found");
    }

    console.log("Running Compound Test");
    await testHandle.select();
    await (await (await testHandle.getActionButton("Run Test")).elem).click();

    // It is expected that the VectorCast Report WebView is the only existing WebView at the moment
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT },
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();
    await expect($(".event*=Event 1")).toHaveText(
      "Event 1 - Calling Manager::PlaceOrder",
    );

    await expect($(".event*=Event 2")).toHaveText(
      "Event 2 - Returned from Manager::PlaceOrder",
    );

    await expect($(".text-muted*=UUT: manager.cpp")).toHaveText(
      "UUT: manager.cpp",
    );

    await expect($(".subprogram*=Manager")).toHaveText("Manager::PlaceOrder");

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });
  
  it("should prepare for debugging with coverage turned ON", async () => {
    await updateTestID();

    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    const explorerSideBarView = await explorerView?.openView();

    const workspaceFolderName = "vcastTutorial";
    const workspaceFolderSection = await explorerSideBarView
      .getContent()
      .getSection(workspaceFolderName.toUpperCase());
    console.log(await workspaceFolderSection.getTitle());
    await workspaceFolderSection.expand();

    const cppFolder = workspaceFolderSection.findItem(".vscode");
    await (await cppFolder).select();

    const launchConfig = workspaceFolderSection.findItem("launch.json");
    await (await (await launchConfig).elem).click();
    await (await launchConfig).openContextMenu();
    await (await $("aria/VectorCAST: Add Launch Configuration")).click();

    console.log("Validating that debug launch configuration got generated");
    let debugConfigTab = (await editorView.openEditor(
      "launch.json",
    )) as TextEditor;
    
    await browser.waitUntil(
      async () => (await debugConfigTab.getText()) !== "",
      { timeout: TIMEOUT },
    );
    await debugConfigTab.moveCursor(1,2)
    await browser.keys(Key.Enter)
    await debugConfigTab.setTextAtLine(2, " // This is a comment")
    await debugConfigTab.save()
    
    const allTextFromDebugConfig = await debugConfigTab.getText();
    expect(allTextFromDebugConfig.includes("configurations")).toBe(true);
    expect(allTextFromDebugConfig.includes("VectorCAST Harness Debug"));

    console.log("Looking for Manager::PlaceOrder in the test tree");
    const vcastTestingViewContent = await getViewContent("Testing");

    console.log("Expanding all test groups");
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "myFirstTest",
          3,
        );
        if (testHandle) {
          break;
        } else {
          throw new Error( "Test handle not found for myFirstTest");
        }
      }
    }

    if (!subprogram) {
      throw new Error( "Subprogram 'manager' not found");
    }

    console.log("Debugging myFirstTest");
    console.log("Clicking on Debug Test button");
    await testHandle.select();
    await (await (await testHandle.getActionButton("Debug Test")).elem).click();
    console.log("Validating debug notifications");

    const debugNotificationText =
      "aria/Ready for debugging, choose launch configuration: &quot;VectorCAST Harness Debug&quot; ...";
    // this will timeout if debugger is not ready and/or debugger notification text is not shown
    await $(debugNotificationText);

    console.log("Waiting for manager_inst.cpp to be open");
    // this times out if manager_vcast.cpp is not ready
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "manager_inst.cpp",
      { timeout: TIMEOUT },
    );
    const activeTab = await editorView.getActiveTab();
    const activeTabTitle = await activeTab.getTitle();
    console.log(activeTabTitle);
    expect(activeTabTitle).toBe("manager_inst.cpp");
    
    // checking that the debug config file still has the comment we added
    debugConfigTab = (await editorView.openEditor(
      "launch.json",
    )) as TextEditor;
    const commentLine = await debugConfigTab.getTextAtLine(2)
    expect(commentLine).toBe("// This is a comment")
    console.log("Finished creating debug configuration");
  });

  it("should prepare for debugging with coverage turned OFF", async () => {
    await updateTestID();
    console.log("Turning off coverage")
    {
      const turnOffCoverageCmd = "cd test/vcastTutorial/cpp/unitTests && clicast -e DATABASE-MANAGER tools coverage disable"
      const { stdout, stderr } = await promisifiedExec(turnOffCoverageCmd);
        
      if (stderr) {
        console.log(stderr);
        throw new Error( `Error when running ${turnOffCoverageCmd}`);
      }
      console.log(stdout)
    }
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    const explorerSideBarView = await explorerView?.openView();

    const workspaceFolderName = "vcastTutorial";
    const workspaceFolderSection = await explorerSideBarView
      .getContent()
      .getSection(workspaceFolderName.toUpperCase());
    console.log(await workspaceFolderSection.getTitle());
    await workspaceFolderSection.expand();

    console.log("Looking for Manager::PlaceOrder in the test tree");
    const vcastTestingViewContent = await getViewContent("Testing");

    console.log("Expanding all test groups");
    let subprogram: TreeItem = undefined;
    let testHandle: TreeItem = undefined;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      subprogram = await findSubprogram("manager", vcastTestingViewSection);
      if (subprogram) {
        await subprogram.expand();
        testHandle = await getTestHandle(
          subprogram,
          "Manager::PlaceOrder",
          "myFirstTest",
          3,
        );
        if (testHandle) {
          break;
        } else {
          throw new Error( "Test handle not found for myFirstTest");
        }
      }
    }

    if (!subprogram) {
      throw new Error( "Subprogram 'manager' not found");
    }

    console.log("Debugging myFirstTest");
    console.log("Clicking on Debug Test button");
    await testHandle.select();
    await (await (await testHandle.getActionButton("Debug Test")).elem).click();
    console.log("Validating debug notifications");

    console.log("Waiting for manager_vcast.cpp to be open");
    // this times out if manager_vcast.cpp is not ready
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "manager_vcast.cpp",
      { timeout: TIMEOUT },
    );
    const activeTab = await editorView.getActiveTab();
    const activeTabTitle = await activeTab.getTitle();
    console.log(activeTabTitle);
    expect(activeTabTitle).toBe("manager_vcast.cpp");

    console.log("Finished creating debug configuration");
    console.log("Turning coverage back on")
    {
      const turnOffCoverageCmd = "cd test/vcastTutorial/cpp/unitTests && clicast -e DATABASE-MANAGER tools coverage enable"
      const { stdout, stderr } = await promisifiedExec(turnOffCoverageCmd);
        
      if (stderr) {
        console.log(stderr);
        throw new Error(`Error when running ${turnOffCoverageCmd}`);
      }
      console.log(stdout)
    }

  });

});
