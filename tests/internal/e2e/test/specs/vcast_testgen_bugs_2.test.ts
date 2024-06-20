// test/specs/vcast.test.ts
import { BottomBarPanel, Workbench } from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  updateTestID,
  testGenMethod,
  generateAllTestsForFunction,
  validateGeneratedTestsForFunction,
  deleteAllTestsForFunction,
  validateTestDeletionForFunction,
  cleanup,
} from "../test_utils/vcast_utils";

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  const TIMEOUT = 120000;
  const QUOTES_ENV = "cpp/unitTests/QUOTES_EXAMPLE";
  const QUOTES_EXAMPLE_UNIT = "quotes_example";
  const QUOTES_EXAMPLE_FUNCTION = "Moo::honk(int,int,int)";
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

  it("should correctly generate all BASIS PATH tests for function", async () => {
    await updateTestID();
    console.log("Generating BASIS PATH tests for quotes_example");
    await generateAllTestsForFunction(
      QUOTES_EXAMPLE_UNIT,
      QUOTES_EXAMPLE_FUNCTION,
      testGenMethod.BasisPath
    );
    await validateGeneratedTestsForFunction(
      QUOTES_ENV,
      QUOTES_EXAMPLE_UNIT,
      QUOTES_EXAMPLE_FUNCTION,
      testGenMethod.BasisPath
    );
  });

  it("should correctly delete all BASIS PATH tests for function", async () => {
    await updateTestID();
    console.log("Deleting BASIS PATH tests for quotes_example");
    await deleteAllTestsForFunction(
      QUOTES_EXAMPLE_UNIT,
      QUOTES_EXAMPLE_FUNCTION,
      testGenMethod.BasisPath
    );
    await validateTestDeletionForFunction(
      QUOTES_EXAMPLE_UNIT,
      QUOTES_EXAMPLE_FUNCTION,
      "BASIS-PATH-001",
      1
    );
  });

  it("should correctly generate all ATG tests for function", async () => {
    await updateTestID();

    if (process.env["ENABLE_ATG_FEATURE"] === "TRUE") {
      console.log("Generating ATG tests for quotes_example");
      await generateAllTestsForFunction(
        QUOTES_EXAMPLE_UNIT,
        QUOTES_EXAMPLE_FUNCTION,
        testGenMethod.ATG
      );
      await validateGeneratedTestsForFunction(
        QUOTES_ENV,
        QUOTES_EXAMPLE_UNIT,
        QUOTES_EXAMPLE_FUNCTION,
        testGenMethod.ATG
      );
    } else {
      console.log("Skipping ATG tests");
    }
  });

  it("should correctly delete all ATG tests for function", async () => {
    await updateTestID();

    if (process.env["ENABLE_ATG_FEATURE"] === "TRUE") {
      console.log("Deleting ATG tests for quotes_example");
      await deleteAllTestsForFunction(
        QUOTES_EXAMPLE_UNIT,
        QUOTES_EXAMPLE_FUNCTION,
        testGenMethod.ATG
      );
      await validateTestDeletionForFunction(
        QUOTES_EXAMPLE_UNIT,
        QUOTES_EXAMPLE_FUNCTION,
        "ATG-TEST-1",
        1
      );
    } else {
      console.log("Skipping ATG tests");
    }
  });

  it("should clean up", async () => {
    await updateTestID();
    await cleanup();
  });
});
