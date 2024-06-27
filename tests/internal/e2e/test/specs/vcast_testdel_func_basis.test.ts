// test/specs/vcast.test.ts
import { BottomBarPanel, Workbench } from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  updateTestID,
  testGenMethod,
  deleteAllTestsForFunction,
  assertTestsDeleted,
  cleanup,
} from "../test_utils/vcast_utils";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  const TIMEOUT = 120000;
  before(async () => {
    workbench = await browser.getWorkbench();
    // opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    process.env["E2E_TEST_ID"] = "0";
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

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
  });

  it("should correctly delete all BASIS PATH tests for function", async () => {
    await updateTestID();
    const bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    console.log(
      "Deleting all BASIS PATH tests for function DataBase::GetTableRecord"
    );
    await deleteAllTestsForFunction(
      "database",
      "DataBase::GetTableRecord",
      testGenMethod.BasisPath
    );
    console.log(
      "Validating deletion of all BASIS PATH tests for function DataBase::GetTableRecord"
    );

    await browser.waitUntil(
      async () => (await outputView.getText()).at(-1) != undefined,
      { timeout: 30000, interval: 1000 }
    );

    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .at(-1)
          .toString()
          .includes("Processing environment data for:"),
      { timeout: 30000, interval: 1000 }
    );
    await browser.pause(10000);

    await assertTestsDeleted("DATABASE-MANAGER");
    await browser.takeScreenshot();
    await browser.saveScreenshot("info_deleted_func_basis_tests.png");
  });

  it("should clean up", async () => {
    await updateTestID();
    await cleanup();
  });
});
