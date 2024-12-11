// Test/specs/vcast.test.ts
import {
  type BottomBarPanel,
  type Workbench,
  CustomTreeItem,
  EditorView,
  TextEditor,
  TreeItem,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  getViewContent,
  updateTestID,
  checkForGutterAndGenerateReport,
  checkElementExistsInHTML,
  findSubprogram,
  executeCtrlClickOn,
  releaseCtrl,
  expandWorkspaceFolderSectionInExplorer,
  findSubprogramMethod,
  insertBasisPathTestFor,
  generateBasisPathTestForSubprogram,
  deleteGeneratedTest,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";
import { checkForServerRunnability } from "../../../../unit/getToolversion";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  let useDataServer: boolean = true;
  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    editorView = workbench.getEditorView();
    process.env.E2E_TEST_ID = "0";
    let releaseIsSuitableForServer = await checkForServerRunnability();
    if (process.env.VCAST_USE_PYTHON || !releaseIsSuitableForServer) {
      useDataServer = false;
    }
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
      { timeout: TIMEOUT }
    );
    console.log("WAITING FOR TEST EXPLORER");
    await browser.waitUntil(async () =>
      (await outputView.getChannelNames())
        .toString()
        .includes("VectorCAST Test Explorer")
    );
    await outputView.selectChannel("VectorCAST Test Explorer");
    console.log("Channel selected");
    console.log("WAITING FOR LANGUAGE SERVER");
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Starting the language server"),
      { timeout: TIMEOUT }
    );
  });

  it("should change coverageKind and Rebuild env", async () => {
    // We need to change the covarage kind to Statement+MCDC in order to get the MCDC lines
    let settingsEditor = await workbench.openSettings();
    const coverageKindSetting = await settingsEditor.findSetting(
      "Coverage Kind",
      "Vectorcast Test Explorer",
      "Build"
    );
    const coverageKindValue = await coverageKindSetting.getValue();
    expect(coverageKindValue).toEqual("Statement");
    await coverageKindSetting.setValue("Statement+MCDC");

    workbench = await browser.getWorkbench();
    const vcastTestingViewContent = await getViewContent("Testing");
    const envName = "cpp/unitTests/DATABASE-MANAGER";

    // When we change the coverage kind --> rebuild env to take effect
    console.log("Re-Building Environment from Test Explorer");
    // Flask --> Right-click on env --> Re-Build environment
    for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
      for (const visibleItem of await vcastTestingViewContentSection.getVisibleItems()) {
        await visibleItem.select();

        const subprogramGroup = visibleItem as CustomTreeItem;
        if ((await subprogramGroup.getTooltip()).includes(envName)) {
          await subprogramGroup.expand();
          const menuItemLabel = "Re-Build Environment";
          const contextMenu = await subprogramGroup.openContextMenu();
          await contextMenu.select("VectorCAST");
          await (await $(`aria/${menuItemLabel}`)).click();
          break;
        }
      }
    }
    const outputView = await bottomBar.openOutputView();
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Environment re-build complete"),
      { timeout: TIMEOUT }
    );
  });

  it("should generate Basis Path tests and check for a fully passed report", async () => {
    // Generating ATG tests is the quickest way to get full coverage and to check for a full covered report.
    workbench = await browser.getWorkbench();
    bottomBar = workbench.getBottomBar();
    const outputView = await bottomBar.openOutputView();
    console.log("Opening Testing View");
    const vcastTestingViewContent = await getViewContent("Testing");
    let subprogram: TreeItem;
    for (const vcastTestingViewSection of await vcastTestingViewContent.getSections()) {
      if (!(await vcastTestingViewSection.isExpanded()))
        await vcastTestingViewSection.expand();

      for (const vcastTestingViewContentSection of await vcastTestingViewContent.getSections()) {
        console.log(await vcastTestingViewContentSection.getTitle());
        await vcastTestingViewContentSection.expand();
        subprogram = await findSubprogram(
          "manager",
          vcastTestingViewContentSection
        );
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
      "Manager::AddIncludedDessert"
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

    // Green MCDC Gutter icon
    await checkForGutterAndGenerateReport(
      19,
      "manager.cpp",
      "cover-icon-with-mcdc",
      true,
      true
    );

    await browser.waitUntil(
      async () => (await outputView.getText()).toString().includes("REPORT:"),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();

    // Some important lines we want to check for in the report
    await expect(await checkElementExistsInHTML("manager.cpp")).toBe(true);
    await expect(await checkElementExistsInHTML("19")).toBe(true);
    await expect(
      await checkElementExistsInHTML("Pairs satisfied: 1 of 1 ( 100% )")
    ).toBe(true);

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });

  it("should check if partially-covered mcdc line generates mcdc report", async () => {
    workbench = await browser.getWorkbench();
    bottomBar = workbench.getBottomBar();
    const outputView = await bottomBar.openOutputView();
    // Orange MCDC Gutter icon
    await checkForGutterAndGenerateReport(
      22,
      "manager.cpp",
      "partially-cover-icon-with-mcdc",
      true,
      true
    );
    await browser.waitUntil(
      async () => (await outputView.getText()).toString().includes("REPORT:"),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();

    // Retrieve the HTML and count the number of div.report-block
    const reportBlockCount = await browser.execute(() => {
      // Use querySelectorAll to count how many <div class="report-block"> elements are in the document
      return document.querySelectorAll("div.report-block").length;
    });

    expect(reportBlockCount).toEqual(1);

    // Some important lines we want to check for in the report
    await expect(await checkElementExistsInHTML("manager.cpp")).toBe(true);
    await expect(await checkElementExistsInHTML("22")).toBe(true);
    await expect(await checkElementExistsInHTML("((a && b) && c)")).toBe(true);
    await expect(
      await checkElementExistsInHTML("Pairs satisfied: 1 of 3 ( 33% )")
    ).toBe(true);

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });

  it("should check if uncovered mcdc line generates mcdc report", async () => {
    workbench = await browser.getWorkbench();
    bottomBar = workbench.getBottomBar();
    const outputView = await bottomBar.openOutputView();
    // Red MCDC Gutter icon
    await checkForGutterAndGenerateReport(
      84,
      "manager.cpp",
      "no-cover-icon-with-mcdc",
      true,
      true
    );
    await browser.waitUntil(
      async () => (await outputView.getText()).toString().includes("REPORT:"),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();

    // Retrieve the HTML and count the number of div.report-block
    const reportBlockCount = await browser.execute(() => {
      // Use querySelectorAll to count how many <div class="report-block"> elements are in the document
      return document.querySelectorAll("div.report-block").length;
    });

    expect(reportBlockCount).toEqual(1);

    // Some important lines we want to check for in the report
    await expect(await checkElementExistsInHTML("manager.cpp")).toBe(true);
    await expect(await checkElementExistsInHTML("84")).toBe(true);
    await expect(await checkElementExistsInHTML("WaitingListSize > (9)")).toBe(
      true
    );
    await expect(
      await checkElementExistsInHTML("Pairs satisfied: 0 of 1 ( 0% )")
    ).toBe(true);

    await webview.close();
    await editorView.closeEditor("VectorCAST Report", 1);
  });

  it("should rebuild env with different coverageKinds and check for gutter icons", async () => {
    const coverageKindList = [
      "BRANCH",
      "Statement+BRANCH",
      "MCDC",
      "Statement+MCDC",
    ];
    const coverageKindOutputMapper = {
      BRANCH: "Branch",
      "Statement+BRANCH": "Statement+Branch",
      MCDC: "MC/DC",
      "Statement+MCDC": "Statement+MC/DC",
    };

    const branchGutterLines = [
      {
        "19": "cover-icon",
        "22": "partially-cover-icon",
        "84": "no-cover-icon",
      },
    ];
    const mcdcGutterLines = [
      {
        "19": "cover-icon-with-mcdc",
        "22": "partially-cover-icon-with-mcdc",
        "84": "no-cover-icon-with-mcdc",
      },
    ];

    for (let coverage of coverageKindList) {
      const workbench = await browser.getWorkbench();
      const activityBar = workbench.getActivityBar();
      const explorerView = await activityBar.getViewControl("Explorer");
      await explorerView?.openView();
      console.log("Deleting Env Folder");
      // Right-Click on ENV Folder and delete it

      const workspaceFolderSection =
        await expandWorkspaceFolderSectionInExplorer("vcastTutorial");
      // const cppFolder = await workspaceFolderSection.findItem("cpp");
      // await cppFolder.select();
      const unitTestsFolder =
        await workspaceFolderSection.findItem("unitTests");
      await unitTestsFolder.select();

      const envFolder =
        await workspaceFolderSection.findItem("DATABASE-MANAGER");
      await envFolder.openContextMenu();
      await (await $("aria/Delete")).click();

      console.log(
        "Change Coverage Kind in DATABASE-MANAGER.env to Statement+MCDC"
      );

      // Open the Editor for the env file and edit the coverage kind by hand
      const envFile = await workspaceFolderSection.findItem(
        "DATABASE-MANAGER.env"
      );
      await envFile.select();
      const editorView = workbench.getEditorView();
      const tab = (await editorView.openEditor(
        "DATABASE-MANAGER.env"
      )) as TextEditor;

      // Search for the line containing the substring
      const content = await tab.getText();
      const lines = content.split("\n");

      const searchTerm = "ENVIRO.COVERAGE_TYPE:";
      const replacement = `ENVIRO.COVERAGE_TYPE: ${coverage}`;

      // Find the line containing the search term and replace the whole line
      const updatedContent = lines
        .map((line) => (line.includes(searchTerm) ? replacement : line))
        .join("\n");

      await tab.setText(updatedContent);
      await tab.save();

      console.log("Building Environment directly from DATABASE-MANAGER.env");

      await envFile.openContextMenu();
      await (await $("aria/Build VectorCAST Environment")).click();

      console.log(
        `Check for logs that Setting Up ${coverageKindOutputMapper[coverage]} Coverage is shown.`
      );

      // The build log should show that the coverage kind is set to Statement+MCDC
      const outputView = await bottomBar.openOutputView();
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes(
              `Setting Up ${coverageKindOutputMapper[coverage]} Coverage`
            ),
        { timeout: TIMEOUT }
      );

      console.log("Generating BASIS-PATHS tests.");
      await generateBasisPathTestForSubprogram(
        "manager",
        "Manager::AddIncludedDessert"
      );

      console.log(
        "Deleting one BASIS-PATHS test for more individual coverage icons."
      );
      await deleteGeneratedTest(
        "manager",
        "Manager::AddIncludedDessert",
        "BASIS-PATH-002",
        4
      );

      console.log("Checking for coverage icons.");
      let listToIterate = [];

      if (coverage == "BRANCH" || coverage == "Statement+BRANCH") {
        listToIterate = branchGutterLines;
      } else {
        listToIterate = mcdcGutterLines;
      }

      for (let line in listToIterate) {
        await checkForGutterAndGenerateReport(
          parseInt(line),
          "manager.cpp",
          listToIterate[line],
          true,
          false
        );
      }
    }
  });

  it("should build new env with nearly identical files and check for mcdc report for double report", async () => {
    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");

    const mooCpp = await workspaceFolderSection.findItem("moo.cpp");
    const fooCpp = await workspaceFolderSection.findItem("foo.cpp");
    await executeCtrlClickOn(mooCpp);
    await executeCtrlClickOn(fooCpp);
    await releaseCtrl();

    await fooCpp.openContextMenu();
    await (await $("aria/Create VectorCAST Environment")).click();

    // Making sure notifications are shown
    await (await $("aria/Notifications")).click();

    console.log(
      "Waiting for clicast and waiting for environment to get processed"
    );
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("Environment built Successfully"),
      { timeout: TIMEOUT }
    );

    console.log("Finished creating vcast environment");
    await browser.takeScreenshot();
    await browser.saveScreenshot(
      "info_finished_creating_vcast_environment.png"
    );
    // Clearing all notifications
    await (await $(".codicon-notifications-clear-all")).click();

    const outputView = await bottomBar.openOutputView();

    // Red MCDC Gutter icon
    await checkForGutterAndGenerateReport(
      15,
      "foo.cpp",
      "no-cover-icon-with-mcdc",
      true,
      true
    );
    await browser.waitUntil(
      async () => (await outputView.getText()).toString().includes("REPORT:"),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webviews = await workbench.getAllWebviews();
    expect(webviews).toHaveLength(1);
    const webview = webviews[0];

    await webview.open();

    // Retrieve the HTML and count the number of div.mcdc-condition no-cvg
    const reportBlockCount = await browser.execute(() => {
      // Use querySelectorAll to count how many <div class="mcdc-condition.no-cvg"> elements are in the document
      // (On CI its div.mcdc-condition.na-cvg)
      // In the double report bug there were 2
      return document.querySelectorAll(
        "div.mcdc-condition.no-cvg, div.mcdc-condition.na-cvg"
      ).length;
    });

    expect(reportBlockCount).toEqual(1);

    // Some important lines we want to check for in the report
    await expect(await checkElementExistsInHTML("foo.cpp")).toBe(true);
    await expect(await checkElementExistsInHTML("15")).toBe(true);

    await webview.close();
  });
});
