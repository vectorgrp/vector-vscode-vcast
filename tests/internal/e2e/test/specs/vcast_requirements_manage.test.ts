import {
  type BottomBarPanel,
  type Workbench,
  TextEditor,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  checkElementExistsInHTML,
  executeContextMenuAction,
  getViewContent,
  selectOutputChannel,
  updateTestID,
} from "../test_utils/vcast_utils";
import { TIMEOUT } from "../test_utils/vcast_utils";
import { checkForServerRunnability } from "../../../../unit/getToolversion";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let useDataServer: boolean = true;
  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
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
    // Wait for the output channel to be populated
    // ── guard the channel‐select so a failure doesn’t abort the test ──
    try {
      await browser.waitUntil(async () =>
        (await outputView.getChannelNames())
          .toString()
          .includes("VectorCAST Requirement Test Generation Operations")
      );
      await outputView.selectChannel(
        "VectorCAST Requirement Test Generation Operations"
      );
      console.log("Channel selected");
    } catch (err) {
      console.warn("selectChannel failed, continuing anyway:", err.message);
    }

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
  });

  it("should generate requirements", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const outputView = await bottomBar.openOutputView();
    // ── guard the channel‐select so a failure doesn’t abort the test ──
    try {
      await outputView.selectChannel(
        "VectorCAST Requirement Test Generation Operations"
      );
      console.log("Channel selected");
    } catch (err) {
      console.warn("selectChannel failed, continuing anyway:", err.message);
    }
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
    const vcastTestingViewContent = await getViewContent("Testing");

    await (await vcastTestingViewContent.elem).click();
    const sections = await vcastTestingViewContent.getSections();
    const testExplorerSection = sections[0];
    const testEnvironments = await testExplorerSection.getVisibleItems();

    await executeContextMenuAction(2, "BAR", true, "Generate Requirements");

    // Should exit with code 0
    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("code2reqs completed successfully with code 0"),
      { timeout: 180_000 }
    );
  });

  it("should show requirements", async () => {
    await updateTestID();

    const workbench = await browser.getWorkbench();
    const activityBar = workbench.getActivityBar();
    const explorerView = await activityBar.getViewControl("Explorer");
    await explorerView?.openView();

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
    const vcastTestingViewContent = await getViewContent("Testing");

    await (await vcastTestingViewContent.elem).click();
    const sections = await vcastTestingViewContent.getSections();
    const testExplorerSection = sections[0];
    const testEnvironments = await testExplorerSection.getVisibleItems();

    await executeContextMenuAction(2, "BAR", true, "Show Requirements");

    const editorView = workbench.getEditorView();
    await browser.waitUntil(
      async () =>
        (await (await editorView.getActiveTab()).getTitle()) ===
        "Requirements Report"
    );

    const tab = (await editorView.openEditor(
      "Requirements Report"
    )) as TextEditor;

    // Expect some HTML stuff to be present
    expect(await checkElementExistsInHTML("Requirements")).toBe(true);
    expect(await checkElementExistsInHTML("bar")).toBe(true);
    expect(await checkElementExistsInHTML("bar.1")).toBe(true);

    await editorView.closeEditor("Requirements Report", 0);
  });

  it("should generate requirements tests", async () => {
    await updateTestID();

    // Find Manager::PlaceOrder subprogram and click on Generate Tests
    await executeContextMenuAction(
      3,
      "bar",
      true,
      "Generate Tests from Requirements"
    );

    await browser.pause(20000);
    const outputView = await bottomBar.openOutputView();

    // Wait for some output to appear (polling getText)
    await browser.waitUntil(
      async () => {
        const text = await outputView.getText();
        return text && text.length > 0;
      },
      { timeout: 10000, timeoutMsg: "Output view text never appeared." }
    );

    // ── guard the channel‐select so a failure doesn’t abort the test ──
    const channels = await outputView.getChannelNames();
    console.log("Available channels:");
    console.log(channels);
    const target = channels.find((ch) =>
      ch.includes("VectorCAST Requirement Test Generation Operations")
    );

    if (target) {
      await outputView.selectChannel(target);
      console.log("Channel selected:", target);
    } else {
      console.warn("Could not find the VectorCAST channel in:", channels);
    }

    await bottomBar.maximize();

    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("reqs2tests completed successfully with code 0"),
      { timeout: 180_000 }
    );

    await browser.waitUntil(
      async () =>
        (await (await bottomBar.openOutputView()).getText())
          .toString()
          .includes("Generating tests: 100%|██████████|"),
      { timeout: 180_000 }
    );
  });
});
