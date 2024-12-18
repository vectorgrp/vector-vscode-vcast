// Test/specs/vcast.test.ts
import {
  type BottomBarPanel,
  type Workbench,
  CustomTreeItem,
  EditorView,
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
  rebuildEnvironmentFromTestingPane,
  TIMEOUT,
} from "../test_utils/vcast_utils";
import { checkForServerRunnability } from "../../../../unit/getToolversion";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let editorView: EditorView;
  let subprogramMethod: CustomTreeItem;
  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
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

    subprogramMethod = await findSubprogramMethod(
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
      "Branch",
      "Statement+Branch",
      "MCDC",
      "Statement+MCDC",
    ];

    // We need a mapper because the the settings are not named 100% the same as the output
    const coverageKindOutputMapper = {
      Branch: "Branch",
      "Statement+Branch": "Statement+Branch",
      MCDC: "MC/DC",
      "Statement+MCDC": "Statement+MC/DC",
    };

    // Coverage checklist for Branch
    const branchGutterLines = [
      {
        "19": "cover-icon",
        "28": "partially-cover-icon",
        "84": "no-cover-icon",
      },
    ];

    // Coverage checklist for MCDC
    const mcdcGutterLines = [
      {
        "19": "cover-icon-with-mcdc",
        "28": "partially-cover-icon-with-mcdc",
        "84": "no-cover-icon-with-mcdc",
      },
    ];

    // Iterate thorugh all possible coverage kinds --> change setting --> rebuild env --> check for gutter icons
    for (let coverage of coverageKindList) {
      const workbench = await browser.getWorkbench();
      const activityBar = workbench.getActivityBar();
      const explorerView = await activityBar.getViewControl("Explorer");
      await explorerView?.openView();

      console.log(`Setting coverageKind to ${coverage}`);
      let settingsEditor = await workbench.openSettings();
      const coverageKindSetting = await settingsEditor.findSetting(
        "Coverage Kind",
        "Vectorcast Test Explorer",
        "Build"
      );
      await coverageKindSetting.setValue(coverage);

      console.log(
        `Rebuild the environment for the new coverage kind ${coverage}`
      );
      const envName = "DATABASE-MANAGER";
      await rebuildEnvironmentFromTestingPane(envName);

      // The build log should show that the coverage kind is set to the correct coverageKind
      console.log(
        `Check for logs that Setting Up ${coverage} Coverage is shown.`
      );
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

      // Generate tests and delete one so that we also can check for partially covered lines
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

      if (coverage == "Branch" || coverage == "Statement+Branch") {
        listToIterate = branchGutterLines;
      } else {
        listToIterate = mcdcGutterLines;
      }

      for (const gutterObject of listToIterate) {
        for (const line in gutterObject) {
          await checkForGutterAndGenerateReport(
            parseInt(line),
            "manager.cpp",
            gutterObject[line],
            true,
            false
          );
        }
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
