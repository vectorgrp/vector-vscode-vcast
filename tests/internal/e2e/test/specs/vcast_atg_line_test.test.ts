// Test/specs/vcast_atg_line_test.test.ts
//
// End-to-end coverage of the "ATG Test for Line" feature:
//   - entering the mode from the editor's line-number context menu (and the
//     menu entry being offered only on statement / branch lines),
//   - the bottom-panel webview: breadcrumbs, source preview, target line,
//     constraint cards for the different variable kinds (int, enum, array,
//     bool), the quick-add search and the decision outcome toggle,
//   - the editor highlight and the status bar item that mirror the state,
//   - the ways of leaving the mode (panel Cancel, status bar quick pick,
//     hiding the panel),
//   - and, when the installed atg supports targeted lines and an LLM provider
//     is configured, generating/loading/revealing/deleting a test, and checking
//     that a true vs false outcome on a simple branch reaches it accordingly.
//
// The spec runs inside the basic_user_interactions group on the
// DATABASE-MANAGER environment built by the earlier specs and leaves the
// environment as it found it (the generated test is deleted again).
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import path from "node:path";
import {
  type BottomBarPanel,
  type CustomTreeItem,
  type OutputView,
  type TextEditor,
  type Workbench,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  assertTestsDeleted,
  deleteTest,
  expandWorkspaceFolderSectionInExplorer,
  findSubprogram,
  findSubprogramMethod,
  getViewContent,
  updateTestID,
  TIMEOUT,
} from "../test_utils/vcast_utils";
import { getToolVersion } from "../../../../unit/getToolversion";

const promisifiedExec = promisify(exec);

const ENV_NAME = "DATABASE-MANAGER";
const UNIT_NAME = "manager";
const UNIT_FILE = "manager.cpp";
// Relative to the e2e folder, which is the cwd of the wdio run.
const ENV_PARENT_DIR = path.join("test", "vcastTutorial", "cpp", "unitTests");
const FUNCTION_NAME = "Manager::PlaceOrder";
const MENU_ITEM = "ATG Test for Line";

// Lines in the tutorial manager.cpp (see Manager::PlaceOrder, lines 36-66):
//   51  TableData.CheckTotal += 14;          statement inside "case Steak"
//   49  switch(Order.Entree) {               decision line
//   45  (blank)                              not a statement / branch line
//   22  if(Order->Entree == Steak &&         multi-line decision (22-24) in
//                                            Manager::AddIncludedDessert
const TARGET_LINE = 51;
const DECISION_LINE = 49;
const BLANK_LINE = 45;
const MULTI_LINE_DECISION = 22;
const PLACE_ORDER_PREVIEW_LINES = 31; // lines 36..66
const ADD_DESSERT_PREVIEW_LINES = 18; // lines 17..34

// if(WaitingListSize > 9) in Manager::AddPartyToWaitingList - a simple branch
// used to check the two outcomes reach opposite sides of the condition (one
// input > 9, the other not).
const BRANCH_LINE = 84;
const BRANCH_FUNCTION = "Manager::AddPartyToWaitingList";

// Colour of the target line decoration (see ATGModeManager.enter)
const TARGET_HIGHLIGHT = "rgba(87,184,89,0.22)";

// Same Azure OpenAI configuration the requirements specs use. The extension
// forwards these settings to atg as VCAST_REQS2X_AZURE_OPENAI_* variables,
// which atg's LLM based path search needs for targeted lines.
const AZURE_DEPLOYMENT = "gpt-4.1-mini";
const AZURE_MODEL_NAME = "gpt-4.1-mini";
const AZURE_API_VERSION = "2024-12-01-preview";

// atg with the LLM path search can take several minutes to produce a test.
const GENERATE_TIMEOUT = 600_000;

type AtgPanel = Awaited<ReturnType<Workbench["getAllWebviews"]>>[number];

describe("vTypeCheck VS Code Extension", () => {
  let bottomBar: BottomBarPanel;
  let workbench: Workbench;
  let panel: AtgPanel;

  // Capabilities of the installation under test, probed in before().
  let atgAvailable = false;
  let hasClangdLocals = false;
  // Set by the LLM settings test, the generation test and used by cleanup.
  let llmConfigured = false;
  let generatedTestName = "";

  before(async () => {
    workbench = await browser.getWorkbench();
    // Opening bottom bar and problems view before running any tests
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    process.env.E2E_TEST_ID = "0";

    // The feature is gated on a licensed atg of a supported version
    // (vectorcastTestExplorer.atgAvailable), the same way the ATG groups are.
    try {
      const toolVersion = await getToolVersion();
      // The workflow sets ENABLE_ATG_FEATURE: TRUE, but GitHub passes it to the
      // job as the string "true", so compare case-insensitively.
      atgAvailable =
        (process.env.ENABLE_ATG_FEATURE ?? "").toUpperCase() === "TRUE" &&
        toolVersion >= 24;
      console.log(
        `Tool version ${toolVersion}, ENABLE_ATG_FEATURE=${process.env.ENABLE_ATG_FEATURE} -> ATG line tests ${atgAvailable ? "enabled" : "skipped"}`
      );
    } catch (error) {
      console.log(`Could not determine the tool version: ${error}`);
    }

    // Local variables (bool / struct fields) come from the clangd bundled with
    // vpython; older releases do not ship it and only offer parameters and
    // globals.
    hasClangdLocals = await vpythonCanImport("monitors4codegen.multilspy");
    console.log(`clangd based local variables available: ${hasClangdLocals}`);
  });

  // Leave the workbench the way the next spec in the group (vcast.rest_3)
  // expects it: no ATG session left active, and the bottom panel back on the
  // Output view rather than the ATG panel tab (which would hide the Output
  // channel selector the next spec's activation step needs).
  after(async () => {
    try {
      await browser.executeWorkbench((vscode) => {
        vscode.commands.executeCommand("vectorcastTestExplorer.atgExitMode");
      });
      await bottomBar.openOutputView();
    } catch (error) {
      console.log(`ATG line test cleanup skipped: ${error}`);
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

    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();
  });

  it("should offer 'ATG Test for Line' only on statement or branch lines", async () => {
    await updateTestID();
    if (!atgAvailable) {
      console.log("Skipping ATG line tests");
      return;
    }

    await openManagerCpp();

    console.log(
      `Checking the line context menu on statement line ${TARGET_LINE}`
    );
    // The coverage gutter icons (and the statement/branch line context keys the
    // menu is gated on) appear once the freshly opened file's coverage data has
    // been processed, so retry briefly.
    let offered = false;
    for (let attempt = 0; attempt < 5 && !offered; attempt++) {
      try {
        await openGutterMenu(TARGET_LINE);
        offered = await $(`aria/${MENU_ITEM}`).isExisting();
        await browser.keys(Key.Escape);
        await waitForContextMenuToClose();
      } catch {
        offered = false;
      }
      if (!offered) await browser.pause(2000);
    }
    expect(offered).toBe(true);

    // A blank line is neither a statement nor a branch line: it carries no
    // coverage gutter icon and the ATG line command's when-clause excludes it,
    // so it can never be an ATG target.
    console.log(`Checking that blank line ${BLANK_LINE} is not targetable`);
    expect(await gutterIconFor(BLANK_LINE)).toBeUndefined();
  });

  it("should enter ATG mode from the context menu and open the panel", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    await enterAtgMode(TARGET_LINE);

    console.log("Checking the status bar item and the editor highlight");
    const statusText = await atgStatusBarText();
    expect(statusText).toContain(`ATG line ${TARGET_LINE}`);
    expect(statusText).toContain("0 constraints");
    // A single statement line: exactly one highlighted line in the editor.
    await waitForTargetHighlights(1);

    console.log("Checking the panel header, preview and empty state");
    panel = await openAtgPanel();
    expect(await $("#crumbFile").getText()).toBe(UNIT_FILE);
    expect(await $("#crumbFn").getText()).toBe(FUNCTION_NAME);
    expect(await $("#crumbLine").getText()).toBe(`Line ${TARGET_LINE}`);
    expect(await $("#decisionBox").isDisplayed()).toBe(false);
    expect(await $("#emptyState").isDisplayed()).toBe(true);
    expect(await $("#varCount").getText()).toBe("0");

    const footer = await $("#footerInfo").getText();
    expect(footer).toContain(ENV_NAME);
    expect(footer).toContain("0 constraints");

    // The preview shows the whole function with the target line marked
    expect(await $$(".code .line")).toHaveLength(PLACE_ORDER_PREVIEW_LINES);
    const targetRow = await $(".code .line.target");
    expect(await targetRow.getAttribute("data-line")).toBe(`${TARGET_LINE}`);
    expect((await targetRow.$(".ln").getText()).trim()).toBe(`${TARGET_LINE}`);
    expect(await targetRow.$(".content").getText()).toContain(
      "TableData.CheckTotal += 14;"
    );

    // Parameters are clickable, the by-value struct parameter is not
    expect((await $$('.code .var[data-path="Table"]')).length).toBeGreaterThan(
      0
    );
    expect((await $$('.code .var[data-path="Seat"]')).length).toBeGreaterThan(
      0
    );
    expect(await $$('.code .var[data-path="Order"]')).toHaveLength(0);
    await panel.close();
  });

  it("should constrain an integer parameter from the source preview", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    panel = await openAtgPanel();
    await clickPreviewVariable("Table");

    const card = await waitForCard("Table");
    expect(await card.$(".badge").getText()).toBe("unsigned int");
    const valueInput = await card.$(".value-row input.val");
    expect(await valueInput.getAttribute("placeholder")).toBe("value, e.g. 42");
    await valueInput.setValue("3");

    expect(await $("#varCount").getText()).toBe("1");
    expect(await $("#emptyState").isDisplayed()).toBe(false);
    expect(
      await $('.code .var[data-path="Table"]').getAttribute("class")
    ).toContain("selected");
    await panel.close();

    await waitForStatusBarText("1 constraint");
  });

  it("should offer enum values in a dropdown for enum fields", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    panel = await openAtgPanel();
    await clickPreviewVariable("Order.Entree");

    const card = await waitForCard("Order.Entree");
    expect(await card.$(".badge").getText()).toBe("enum");
    const select = await card.$("select.input");
    const optionTexts: string[] = [];
    for (const option of await select.$$("option")) {
      optionTexts.push(await option.getText());
    }
    expect(optionTexts).toEqual([
      "any value",
      "NoEntree",
      "Steak",
      "Chicken",
      "Lobster",
      "Pasta",
    ]);
    await select.selectByVisibleText("Steak");
    expect(await select.getValue()).toBe("Steak");

    // The host keeps the values: the re-render triggered by adding a second
    // variable did not reset the integer typed before
    expect(
      await (await waitForCard("Table")).$(".value-row input.val").getValue()
    ).toBe("3");
    expect(await $("#varCount").getText()).toBe("2");
    await panel.close();

    await waitForStatusBarText("2 constraints");
  });

  it("should show index editors for a subscripted array variable", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    panel = await openAtgPanel();
    // TableData.Order[Seat] = Order;  -> the clicked line provides the index
    await clickPreviewVariable("TableData.Order");

    let card = await waitForCard("TableData.Order");
    expect(await card.getAttribute("class")).toContain("kind-array");
    let rows = await card.$$(".value-row");
    expect(rows).toHaveLength(1);
    expect(await rows[0].$(".arr-label").getText()).toBe("TableData.Order[");
    expect(await rows[0].$("input.idx").getValue()).toBe("Seat");
    await rows[0].$("input.val").setValue("1");

    console.log("Adding and removing a second index");
    await card.$("button.link-btn").click();
    await browser.waitUntil(
      async () =>
        (await (await waitForCard("TableData.Order")).$$(".value-row"))
          .length === 2,
      { timeout: 10_000, timeoutMsg: "second array entry did not appear" }
    );
    // Structural changes rebuild the card, so re-query it
    card = await waitForCard("TableData.Order");
    rows = await card.$$(".value-row");
    await rows[1].$("input.idx").setValue("0");
    await rows[1].$("input.val").setValue("2");
    await rows[1].$(".icon-btn.remove").click();
    await browser.waitUntil(
      async () =>
        (await (await waitForCard("TableData.Order")).$$(".value-row"))
          .length === 1,
      { timeout: 10_000, timeoutMsg: "second array entry was not removed" }
    );
    card = await waitForCard("TableData.Order");
    rows = await card.$$(".value-row");
    expect(await rows[0].$("input.idx").getValue()).toBe("Seat");
    expect(await rows[0].$("input.val").getValue()).toBe("1");

    // An array counts as one constraint however many indices it has
    expect(await $("#varCount").getText()).toBe("3");
    await panel.close();

    await waitForStatusBarText("3 constraints");
  });

  it("should edit a boolean struct field with the true/false toggle", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    panel = await openAtgPanel();

    if (hasClangdLocals) {
      // Locals are fetched asynchronously after entering the mode; wait until
      // the quick-add search knows the local before clicking it, otherwise
      // the field would be added as an untyped unknown.
      console.log("Waiting for the clangd locals to arrive");
      const quickAddInput = await $("#quickAddInput");
      await quickAddInput.click();
      await quickAddInput.setValue("IsOccupied");
      await browser.waitUntil(
        async () => (await quickAddPaths()).includes("TableData.IsOccupied"),
        {
          timeout: TIMEOUT,
          timeoutMsg: "TableData.IsOccupied never showed up as a local",
        }
      );
      const localItem = (await $$("#quickAddList li[role=option]"))[0];
      // The group label is uppercased by CSS, so compare case-insensitively.
      expect((await localItem.$(".qa-group").getText()).toLowerCase()).toBe(
        "local"
      );
      await browser.keys(Key.Escape);
      await quickAddInput.setValue("");
      await browser.keys(Key.Escape);
    }

    // TableData.IsOccupied = true;
    await clickPreviewVariable("TableData.IsOccupied");
    const card = await waitForCard("TableData.IsOccupied");

    if (hasClangdLocals) {
      expect(await card.getAttribute("class")).toContain("kind-bool");
      expect(await card.$(".badge").getText()).toBe("bool");
      const choices = await card.$$(".seg button");
      expect(choices).toHaveLength(3);
      expect(
        await card.$('.seg button[data-val=""]').getAttribute("class")
      ).toContain("active");
      await card.$('.seg button[data-val="true"]').click();
      expect(
        await card.$('.seg button[data-val="true"]').getAttribute("class")
      ).toContain("active");
      expect(
        await card.$('.seg button[data-val=""]').getAttribute("class")
      ).not.toContain("active");
    } else {
      console.log("No clangd locals: the field is an untyped text input");
      expect(await card.getAttribute("class")).toContain("kind-unknown");
      await card.$(".value-row input.val").setValue("true");
    }

    expect(await $("#varCount").getText()).toBe("4");
    await panel.close();

    await waitForStatusBarText("4 constraints");
  });

  it("should add variables through the quick-add search", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    panel = await openAtgPanel();
    const quickAddInput = await $("#quickAddInput");
    await quickAddInput.click();
    await quickAddInput.setValue("Sea");
    await $("#quickAddList").waitForDisplayed({ timeout: 10_000 });

    const paths = await quickAddPaths();
    expect(paths).toContain("Seat");
    expect(paths).not.toContain("Table"); // already constrained
    const seatItem = (await $$("#quickAddList li[role=option]"))[0];
    expect(await seatItem.$(".qa-path").getText()).toBe("Seat");
    expect(await seatItem.$(".qa-type").getText()).toBe("unsigned int");
    // The group label is uppercased by CSS, so compare case-insensitively.
    expect((await seatItem.$(".qa-group").getText()).toLowerCase()).toBe(
      "param"
    );

    console.log("Enter picks the highlighted variable");
    await browser.keys(Key.Enter);
    const card = await waitForCard("Seat");
    expect(await card.$(".badge").getText()).toBe("unsigned int");
    expect(await $("#varCount").getText()).toBe("5");

    console.log("Constrained variables are not offered again");
    await quickAddInput.setValue("Seat");
    await browser.waitUntil(
      async () => await $("#quickAddList li.none").isExisting(),
      { timeout: 10_000 }
    );
    expect(await $("#quickAddList li.none").getText()).toContain(
      "No variables match"
    );
    await browser.keys(Key.Escape);
    await browser.waitUntil(
      async () => !(await $("#quickAddList").isDisplayed()),
      { timeout: 10_000, timeoutMsg: "Escape did not close the quick-add list" }
    );
    await quickAddInput.setValue("");
    await panel.close();

    await waitForStatusBarText("5 constraints");
  });

  it("should remove constraints from the card and from the preview", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    panel = await openAtgPanel();

    console.log("Removing Table with the card's remove button");
    await (await waitForCard("Table"))
      .$('.icon-btn.remove[aria-label="Remove Table"]')
      .click();
    await waitForCardGone("Table");
    expect(await $("#varCount").getText()).toBe("4");
    expect(
      await $('.code .var[data-path="Table"]').getAttribute("class")
    ).not.toContain("selected");

    console.log("Clicking a selected variable in the preview toggles it off");
    await clickPreviewVariable("Seat");
    await waitForCardGone("Seat");
    expect(await $("#varCount").getText()).toBe("3");
    await panel.close();

    await waitForStatusBarText("3 constraints");
  });

  it("should re-target a decision line and toggle the expected outcome", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    // Entering again from another line restarts the session on that line
    await enterAtgMode(DECISION_LINE);
    // Re-targeting moves the highlight; still a single-line decision here.
    await waitForTargetHighlights(1);

    panel = await openAtgPanel();
    expect(await $("#crumbFn").getText()).toBe(FUNCTION_NAME);
    expect(await $("#crumbLine").getText()).toBe(`Line ${DECISION_LINE}`);
    expect(await $("#varCount").getText()).toBe("0");
    expect(await $("#decisionBox").isDisplayed()).toBe(true);
    expect(
      await $('#truthSeg button[data-truth=""]').getAttribute("class")
    ).toContain("active");

    await $('#truthSeg button[data-truth="True"]').click();
    await browser.waitUntil(
      async () =>
        (
          await $('#truthSeg button[data-truth="True"]').getAttribute("class")
        ).includes("active"),
      { timeout: 10_000, timeoutMsg: "True outcome was not activated" }
    );
    expect(
      await $('#truthSeg button[data-truth=""]').getAttribute("class")
    ).not.toContain("active");
    await panel.close();

    await waitForStatusBarText(`ATG line ${DECISION_LINE} [True]`);
  });

  it("should highlight a multi-line decision in another function", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    await enterAtgMode(MULTI_LINE_DECISION);

    // The decision spans three source lines, all highlighted as one target:
    //   if(Order->Entree == Steak &&           <- 22
    //      Order->Salad == Caesar &&           <- 23
    //      Order->Beverage == MixedDrink) {    <- 24
    await waitForTargetHighlights(3);

    panel = await openAtgPanel();
    expect(await $("#crumbFn").getText()).toBe("Manager::AddIncludedDessert");
    expect(await $("#crumbLine").getText()).toBe(`Line ${MULTI_LINE_DECISION}`);
    expect(await $("#decisionBox").isDisplayed()).toBe(true);
    expect(await $$(".code .line")).toHaveLength(ADD_DESSERT_PREVIEW_LINES);

    // The pointer parameter is an assignable array-like variable ...
    await clickPreviewVariable("Order");
    const pointerCard = await waitForCard("Order");
    expect(await pointerCard.getAttribute("class")).toContain("kind-array");
    expect(await pointerCard.$(".badge").getText()).toBe("OrderType*");
    // ... whose default index is empty because "Order" is not subscripted
    expect(await pointerCard.$("input.idx").getValue()).toBe("");
    expect(await $("#varCount").getText()).toBe("1");
    await panel.close();
  });

  it("should cancel from the panel button", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    await enterAtgMode(TARGET_LINE);
    panel = await openAtgPanel();
    const cancelButton = await $("#btnCancel");
    await cancelButton.waitForClickable({ timeout: 10_000 });
    await cancelButton.click();
    await panel.close();

    await waitForModeExit();
    // Leaving the mode clears the highlight.
    await waitForTargetHighlights(0);
  });

  it("should treat hiding the panel as cancel", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    await enterAtgMode(TARGET_LINE);
    // The panel is revealed by entering the mode; give it a moment past the
    // reveal (visibility changes within the first second are ignored by design)
    // before switching away.
    await browser.pause(1500);

    console.log("Switching the panel to the Output view");
    await bottomBar.openOutputView();
    await browser.waitUntil(
      async () =>
        (await outputView.getText()).toString().includes("ATG Mode: Exited"),
      { timeout: TIMEOUT, timeoutMsg: "hiding the panel did not exit the mode" }
    );
    expect((await outputView.getText()).toString()).toContain(
      `ATG Mode: Active on line ${TARGET_LINE} of ${UNIT_FILE}`
    );
    await waitForModeExit();
  });

  // Runs after the other exit tests: opening the status bar's quick pick leaves
  // the workbench focus in a state that makes the *next* freshly entered panel
  // flaky, so this panel-independent check goes last.
  it("should cancel from the status bar quick pick", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    await enterAtgMode(TARGET_LINE);
    const statusItem = await findAtgStatusBarItem();
    expect(statusItem).toBeDefined();
    await statusItem.click();

    // The status bar item opens a quick pick with a Generate and a Cancel
    // action. Filter to the Cancel one by typing and choose it with Enter,
    // which avoids brittle list-row selectors.
    const quickInput = await $(".quick-input-widget");
    await quickInput.waitForDisplayed({ timeout: 10_000 });
    for (const character of "Cancel ATG Test") {
      await browser.keys(character);
    }
    await browser.keys(Key.Enter);

    await waitForModeExit();
    // Leaving the mode clears the highlight.
    await waitForTargetHighlights(0);
  });

  it("should configure the Azure OpenAI provider used by ATG's path search", async () => {
    await updateTestID();
    if (!atgAvailable) return;
    if (!process.env.OPENAI_API_KEY || !process.env.AZURE_BASE_URL) {
      console.log(
        "OPENAI_API_KEY / AZURE_BASE_URL not set: ATG line test generation will be skipped"
      );
      return;
    }

    console.log(`API key length: ${process.env.OPENAI_API_KEY.length}`);
    await setAzureSetting("Api Key", process.env.OPENAI_API_KEY);
    console.log(`Base URL length: ${process.env.AZURE_BASE_URL.length}`);
    await setAzureSetting("Base Url", process.env.AZURE_BASE_URL);
    await setAzureSetting("Deployment", AZURE_DEPLOYMENT);
    await setAzureSetting("Model Name", AZURE_MODEL_NAME);
    await setAzureSetting("Api Version", AZURE_API_VERSION);
    llmConfigured = true;
  });

  it("should generate, load and reveal an ATG test for the line with the chosen constraints", async () => {
    await updateTestID();
    if (!atgAvailable) return;

    // When PyATG and an LLM provider are actually present, run for real and let
    // a failure be a failure. Skip only when a prerequisite is genuinely
    // missing (local dev, or a group without the PyATG checkout).
    const prereq = await generationPrerequisites();
    if (!prereq.ok) {
      console.log(`Skipping ATG line test generation: ${prereq.reason}`);
      return;
    }

    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    await enterAtgMode(TARGET_LINE);
    panel = await openAtgPanel();
    await clickPreviewVariable("Table");
    await (await waitForCard("Table")).$(".value-row input.val").setValue("3");
    await clickPreviewVariable("Order.Entree");
    await (await waitForCard("Order.Entree"))
      .$("select.input")
      .selectByVisibleText("Steak");
    expect(await $("#varCount").getText()).toBe("2");

    console.log("Generating the test");
    const generateButton = await $("#btnFetch");
    await generateButton.waitForClickable({ timeout: 10_000 });
    await generateButton.click();
    await panel.close();
    await waitForModeExit();

    await bottomBar.openOutputView();
    const log = await waitForScriptLoaded(outputView);
    expect(log).toContain(`VCAST_ATG_TARGETED_LINE=${TARGET_LINE}`);
    expect(log).toContain(`VCAST_ATG_TARGETED_FILE=${UNIT_FILE}`);
    expect(log).toContain(
      "VCAST_ATG_TARGETED_VALUES=Table:3;Order.Entree:Steak"
    );

    console.log("Looking for the new test in the Testing view");
    const testHandle = await waitForLineTest(
      new RegExp(`^ATG-MANAGER-LINE-${TARGET_LINE}`)
    );
    generatedTestName = (await (await testHandle.elem).getText()).trim();
    console.log(`Generated test: ${generatedTestName}`);

    console.log("Checking the loaded test script");
    const script = await exportTestScript();
    const testBlock = extractTestBlock(script, generatedTestName);
    expect(testBlock).toContain(`TEST.UNIT:${UNIT_NAME}`);
    expect(testBlock).toMatch(/TEST\.SUBPROGRAM:Manager::PlaceOrder/);
    expect(testBlock).toMatch(
      /TEST\.VALUE:manager\.Manager::PlaceOrder(\([^)]*\))?\.Table:3/
    );
    expect(testBlock).toMatch(
      /TEST\.VALUE:manager\.Manager::PlaceOrder(\([^)]*\))?\.Order\.Entree:Steak/
    );
    expect(testBlock).toContain(`Targeted Line: ${UNIT_FILE}:${TARGET_LINE}`);
  });

  it("should delete the generated ATG line test again", async () => {
    await updateTestID();
    if (!atgAvailable || !generatedTestName) {
      console.log("No generated ATG line test to delete");
      return;
    }

    const testHandle = await waitForLineTest(
      new RegExp(`^${generatedTestName}$`)
    );
    await deleteTest(testHandle);

    const outputView = await bottomBar.openOutputView();
    await browser.waitUntil(
      async () =>
        (await outputView.getText())
          .toString()
          .includes("Processing environment data"),
      { timeout: TIMEOUT }
    );
    await browser.waitUntil(
      async () =>
        (await findLineTest(new RegExp(`^${generatedTestName}$`))) ===
        undefined,
      { timeout: TIMEOUT, timeoutMsg: "the test is still in the Testing view" }
    );
    await assertTestsDeleted(ENV_NAME, generatedTestName);
  });

  it("should reach the branch with the chosen true/false outcome", async () => {
    await updateTestID();
    if (!atgAvailable) return;
    const prereq = await generationPrerequisites();
    if (!prereq.ok) {
      console.log(`Skipping the range check: ${prereq.reason}`);
      return;
    }

    // if(WaitingListSize > 9): the two outcomes must reach opposite sides of the
    // condition. Assert that (one input is > 9 and the other is not) rather than
    // fixing which outcome is which - the value ATG picks is its own choice, and
    // observed true/false-to-value direction is not the intuitive one.
    console.log("Generating a test for one outcome");
    const trueRun = await generateWithOutcome(
      BRANCH_LINE,
      BRANCH_FUNCTION,
      "True"
    );
    expect(trueRun.log).toContain(
      `VCAST_ATG_TARGETED_LINE=${BRANCH_LINE}:True`
    );
    const trueValues = waitingListSizeValues(trueRun.block);
    expect(trueValues.length).toBeGreaterThan(0);
    await deleteLineTest(trueRun.handle, BRANCH_FUNCTION);

    console.log("Generating a test for the opposite outcome");
    const falseRun = await generateWithOutcome(
      BRANCH_LINE,
      BRANCH_FUNCTION,
      "False"
    );
    expect(falseRun.log).toContain(
      `VCAST_ATG_TARGETED_LINE=${BRANCH_LINE}:False`
    );
    const falseValues = waitingListSizeValues(falseRun.block);
    expect(falseValues.length).toBeGreaterThan(0);

    // Opposite sides of the branch: exactly one outcome's input exceeds 9.
    const trueAbove = trueValues.some((value) => value > 9);
    const falseAbove = falseValues.some((value) => value > 9);
    expect(trueAbove).not.toBe(falseAbove);
    await deleteLineTest(falseRun.handle, BRANCH_FUNCTION);
  });

  it("should reset the Azure OpenAI settings", async () => {
    await updateTestID();
    if (!llmConfigured) return;
    await setAzureSetting("Api Key", "");
    await setAzureSetting("Base Url", "");
    await setAzureSetting("Deployment", "");
    await setAzureSetting("Model Name", "");
  });

  // ─── helpers ─────────────────────────────────────────────────────

  async function openManagerCpp(): Promise<TextEditor> {
    const workspaceFolderSection =
      await expandWorkspaceFolderSectionInExplorer("vcastTutorial");
    let managerCpp = await workspaceFolderSection.findItem(UNIT_FILE);
    if (!managerCpp) {
      const cppFolder = await workspaceFolderSection.findItem("cpp");
      await cppFolder.select();
      managerCpp = await workspaceFolderSection.findItem(UNIT_FILE);
    }
    const editorView = workbench.getEditorView();
    if (!(await editorView.getOpenEditorTitles()).includes(UNIT_FILE)) {
      await managerCpp.select();
    }
    return (await editorView.openEditor(UNIT_FILE)) as TextEditor;
  }

  async function focusEditor() {
    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    });
    // Give the focus change time to land before sending cursor keys
    await browser.pause(300);
  }

  /**
   * Move the cursor to `line` and scroll it into view through the editor API.
   * TextEditor.moveCursor drives the cursor with keystrokes and guards on
   * TextEditor.getNumberOfLines, which reads the document through the system
   * clipboard; that clipboard is empty under headless Xvfb, so the guard
   * rejects any line beyond the first. Revealing the range directly avoids the
   * clipboard entirely and also renders the line-number gutter element the
   * context-menu step needs.
   */
  async function revealEditorLine(line: number) {
    await browser.executeWorkbench((vscode, targetLine: number) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const position = new vscode.Position(targetLine - 1, 0);
      editor.selection = new vscode.Selection(position, position);
      // 2 === vscode.TextEditorRevealType.InCenter
      editor.revealRange(new vscode.Range(position, position), 2);
    }, line);
    await browser.pause(400);
  }

  /** The coverage gutter icon element on `line`, or undefined if there is none. */
  async function gutterIconFor(line: number) {
    await revealEditorLine(line);
    const lineNumberElement = await $(`.line-numbers=${line}`);
    await lineNumberElement.waitForExist({ timeout: 10_000 });
    const marginLine = await lineNumberElement.parentElement();
    const icon = await marginLine.$(".cgmr.codicon");
    return (await icon.isExisting()) ? icon : undefined;
  }

  /**
   * Open the line-number context menu on `line` by right-clicking its coverage
   * gutter icon. Right-clicking the coverage icon opens the
   * editor/lineNumber/context menu reliably (the same approach the coverage
   * report helper uses); right-clicking the bare line number only selects the
   * line. Only statement / branch lines carry the icon, which is exactly where
   * the ATG line command is offered.
   */
  async function openGutterMenu(line: number) {
    await focusEditor();
    const icon = await gutterIconFor(line);
    if (!icon) {
      throw new Error(`No coverage gutter icon on line ${line}`);
    }
    await icon.click({ button: 2 });
    await $(".monaco-menu").waitForDisplayed({ timeout: 10_000 });
  }

  async function waitForContextMenuToClose() {
    await browser.waitUntil(
      async () =>
        !(await $(".monaco-menu")
          .isDisplayed()
          .catch(() => false)),
      { timeout: 10_000, timeoutMsg: "context menu did not close" }
    );
  }

  /**
   * Enter the mode on `line` through the context menu. Any previous session is
   * ended first so entering is always a clean start (each caller expects a
   * fresh session with no constraints), and manager.cpp is reopened so it works
   * even after a test that closed all editors.
   */
  async function enterAtgMode(line: number) {
    await browser.executeWorkbench((vscode) => {
      vscode.commands.executeCommand("vectorcastTestExplorer.atgExitMode");
    });
    await waitForModeExit();
    await openManagerCpp();
    console.log(`Entering ATG Test for Line on line ${line}`);
    await openGutterMenu(line);
    await $(`aria/${MENU_ITEM}`).waitForExist({ timeout: 10_000 });
    await (await $(`aria/${MENU_ITEM}`)).click();
    await waitForStatusBarText(`ATG line ${line}`);
  }

  /** Switch into the panel webview. Leaves the driver inside the frame. */
  async function openAtgPanel(): Promise<AtgPanel> {
    let found: AtgPanel | undefined;
    await browser.waitUntil(
      async () => {
        for (const webview of await workbench.getAllWebviews()) {
          await webview.open();
          if (
            (await $("#app").isExisting()) &&
            (await $("#app").isDisplayed())
          ) {
            found = webview;
            return true;
          }
          await webview.close();
        }
        return false;
      },
      {
        timeout: TIMEOUT,
        timeoutMsg: "the ATG Test for Line panel did not open",
      }
    );
    return found;
  }

  async function clickPreviewVariable(variablePath: string) {
    const token = await $(`.code .var[data-path="${variablePath}"]`);
    await token.waitForExist({ timeout: 10_000 });
    await token.scrollIntoView();
    await token.click();
  }

  async function waitForCard(variablePath: string) {
    const card = await $(`.var-card[data-path="${variablePath}"]`);
    await card.waitForExist({
      timeout: 10_000,
      timeoutMsg: `constraint card for ${variablePath} did not appear`,
    });
    return card;
  }

  async function waitForCardGone(variablePath: string) {
    await browser.waitUntil(
      async () =>
        !(await $(`.var-card[data-path="${variablePath}"]`).isExisting()),
      {
        timeout: 10_000,
        timeoutMsg: `constraint card for ${variablePath} was not removed`,
      }
    );
  }

  async function quickAddPaths(): Promise<string[]> {
    const paths: string[] = [];
    for (const item of await $$("#quickAddList li[role=option] .qa-path")) {
      paths.push(await item.getText());
    }
    return paths;
  }

  async function atgStatusBarText(): Promise<string | undefined> {
    const items = await workbench.getStatusBar().getItems();
    return items.find((text) => text.includes("ATG line"));
  }

  async function waitForStatusBarText(expected: string) {
    await browser.waitUntil(
      async () => ((await atgStatusBarText()) ?? "").includes(expected),
      {
        timeout: TIMEOUT,
        timeoutMsg: `status bar never showed '${expected}' (last: '${await atgStatusBarText()}')`,
      }
    );
  }

  async function waitForModeExit() {
    await browser.waitUntil(
      async () => (await atgStatusBarText()) === undefined,
      {
        timeout: TIMEOUT,
        timeoutMsg: "the ATG status bar item did not go away",
      }
    );
  }

  async function findAtgStatusBarItem() {
    for (const item of await $$(
      'footer[id="workbench.parts.statusbar"] .statusbar-item'
    )) {
      if ((await item.getText()).includes("ATG line")) return item;
    }
    return undefined;
  }

  /**
   * How many editor lines currently show the whole-line ATG target decoration.
   * The decoration paints a full-width element in the editor's view overlays
   * with the fixed target colour, one per highlighted line, so counting the
   * elements of that exact colour tells us how many lines are marked (one for a
   * single-line target, the whole span for a multi-line decision, zero once the
   * mode is left) without depending on which DOM index maps to which line.
   */
  async function countTargetHighlights(): Promise<number> {
    return browser.execute((wantedColor: string) => {
      let count = 0;
      for (const overlay of Array.from(
        document.querySelectorAll(".monaco-editor .view-overlays > div")
      )) {
        const marked = Array.from(overlay.querySelectorAll("*")).some(
          (element) =>
            getComputedStyle(element).backgroundColor.replace(/\s/g, "") ===
            wantedColor
        );
        if (marked) count++;
      }
      return count;
    }, TARGET_HIGHLIGHT);
  }

  /** Wait until exactly `expected` editor lines carry the target highlight. */
  async function waitForTargetHighlights(expected: number) {
    await browser.waitUntil(
      async () => (await countTargetHighlights()) === expected,
      {
        timeout: 15_000,
        timeoutMsg: `expected ${expected} highlighted target line(s), last saw ${await countTargetHighlights()}`,
      }
    );
  }

  /**
   * Wait for the generated ATG line test to load. On timeout, dump the tail of
   * the VectorCAST output so the reason (atg error, LLM failure, still running)
   * is visible in the job log instead of just "not loaded".
   */
  async function waitForScriptLoaded(outputView: OutputView): Promise<string> {
    try {
      await browser.waitUntil(
        async () =>
          (await outputView.getText())
            .toString()
            .includes("Script loaded successfully"),
        { timeout: GENERATE_TIMEOUT, interval: 2000 }
      );
    } catch {
      const out = (await outputView.getText()).toString();
      console.log("=== ATG generation output (tail) ===");
      console.log(out.split(/\r?\n/).slice(-80).join("\n"));
      console.log("=== end ATG generation output ===");
      throw new Error("the ATG line test was not loaded (see output above)");
    }

    return (await outputView.getText()).toString();
  }

  async function findLineTest(
    pattern: RegExp,
    functionName: string = FUNCTION_NAME
  ): Promise<CustomTreeItem | undefined> {
    const vcastTestingViewContent = await getViewContent("Testing");
    for (const section of await vcastTestingViewContent.getSections()) {
      const subprogram = await findSubprogram(UNIT_NAME, section);
      if (!subprogram) continue;
      await subprogram.expand();
      const method = await findSubprogramMethod(subprogram, functionName);
      if (!method)
        throw new Error(`${functionName} not found in the Testing view`);
      if (!(await method.isExpanded())) await method.expand();
      for (const child of await method.getChildren()) {
        const label = (
          await (await (child as CustomTreeItem).elem).getText()
        ).trim();
        if (pattern.test(label)) return child as CustomTreeItem;
      }
      return undefined;
    }
    throw new Error(`Unit ${UNIT_NAME} not found in the Testing view`);
  }

  async function waitForLineTest(
    pattern: RegExp,
    functionName: string = FUNCTION_NAME
  ): Promise<CustomTreeItem> {
    let handle: CustomTreeItem | undefined;
    await browser.waitUntil(
      async () => {
        handle = await findLineTest(pattern, functionName);
        return handle !== undefined;
      },
      {
        timeout: TIMEOUT,
        timeoutMsg: `no test matching ${pattern} under ${functionName}`,
      }
    );
    return handle;
  }

  /**
   * Generate an ATG line test on `line` with a decision outcome, wait for it to
   * load, and return the run's log plus the generated test's script block and
   * its tree handle.
   */
  async function generateWithOutcome(
    line: number,
    functionName: string,
    truth: "True" | "False"
  ): Promise<{ log: string; block: string; handle: CustomTreeItem }> {
    const outputView = await bottomBar.openOutputView();
    await outputView.clearText();

    await enterAtgMode(line);
    panel = await openAtgPanel();
    const outcomeButton = await $(`#truthSeg button[data-truth="${truth}"]`);
    await outcomeButton.waitForClickable({ timeout: 10_000 });
    await outcomeButton.click();
    await browser.waitUntil(
      async () =>
        (await outcomeButton.getAttribute("class")).includes("active"),
      { timeout: 10_000, timeoutMsg: `${truth} outcome was not activated` }
    );
    const generateButton = await $("#btnFetch");
    await generateButton.waitForClickable({ timeout: 10_000 });
    await generateButton.click();
    await panel.close();
    await waitForModeExit();

    await bottomBar.openOutputView();
    const log = await waitForScriptLoaded(outputView);

    const handle = await waitForLineTest(
      new RegExp(`^ATG-${UNIT_NAME.toUpperCase()}-LINE-${line}`),
      functionName
    );
    const name = (await (await handle.elem).getText()).trim();
    const block = extractTestBlock(await exportTestScript(), name);
    return { log, block, handle };
  }

  /** Every numeric TEST.VALUE assigned to WaitingListSize in a test block. */
  function waitingListSizeValues(block: string): number[] {
    const values: number[] = [];
    const regex = /WaitingListSize\b[^:\n]*:\s*(\d+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(block)) !== null) {
      values.push(Number(match[1]));
    }
    return values;
  }

  /** Delete a generated line test and wait for it to leave the tree. */
  async function deleteLineTest(
    handle: CustomTreeItem,
    functionName: string
  ): Promise<void> {
    const name = (await (await handle.elem).getText()).trim();
    await deleteTest(handle);
    await browser.waitUntil(
      async () =>
        (await findLineTest(new RegExp(`^${name}$`), functionName)) ===
        undefined,
      { timeout: TIMEOUT, timeoutMsg: `${name} was not deleted from the tree` }
    );
  }

  /** Export the environment's tests to a script and return its content. */
  async function exportTestScript(): Promise<string> {
    const scriptName = "atg-line-e2e.tst";
    const command = `cd ${ENV_PARENT_DIR} && ${process.env.VECTORCAST_DIR}/clicast -e ${ENV_NAME} test script create ${scriptName}`;
    const { stderr } = await promisifiedExec(command);
    if (stderr) console.log(stderr);
    const scriptPath = path.join(ENV_PARENT_DIR, scriptName);
    const content = fs.readFileSync(scriptPath, "utf8");
    fs.rmSync(scriptPath, { force: true });
    return content;
  }

  /** The part of a .tst between TEST.NAME:<name> and its TEST.END. */
  function extractTestBlock(script: string, testName: string): string {
    const lines = script.split(/\r?\n/);
    const nameIndex = lines.findIndex(
      (line) => line.trim() === `TEST.NAME:${testName}`
    );
    expect(nameIndex).toBeGreaterThan(-1);
    let start = nameIndex;
    while (start > 0 && !lines[start - 1].startsWith("TEST.END")) start--;
    let end = nameIndex;
    while (end < lines.length && lines[end].trim() !== "TEST.END") end++;
    return lines.slice(start, end + 1).join("\n");
  }

  async function vpythonCanImport(moduleName: string): Promise<boolean> {
    if (!process.env.VECTORCAST_DIR) return false;
    try {
      await promisifiedExec(
        `${process.env.VECTORCAST_DIR}/vpython -c "import ${moduleName}"`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Whether ATG line-test generation is expected to work: PyATG is wired
   * (VCAST_ATG_PATH points at a real file), an LLM provider is configured, and
   * the release's bundled Python is new enough to run PyATG. When all hold the
   * generation tests run for real and a failure is a real failure; otherwise
   * they are skipped with a logged reason (local dev, a group without PyATG, or
   * a release whose Python is too old).
   */
  async function generationPrerequisites(): Promise<{
    ok: boolean;
    reason: string;
  }> {
    const atgPath = process.env.VCAST_ATG_PATH;
    if (!atgPath || !fs.existsSync(atgPath)) {
      return {
        ok: false,
        reason:
          "PyATG is not wired (VCAST_ATG_PATH unset or missing); the release atg cannot target a line",
      };
    }

    if (!llmConfigured) {
      return {
        ok: false,
        reason: "no LLM provider configured (OPENAI_API_KEY / AZURE_BASE_URL)",
      };
    }

    // PyATG uses typing.Self, which only exists in Python 3.11+. Some releases
    // bundle an older vpython that cannot import it (atg then exits with an
    // ImportError), so generation genuinely cannot run on those.
    const python = await vpythonVersion();
    if (!python.atLeast311) {
      return {
        ok: false,
        reason: `PyATG needs Python 3.11+, but this release's vpython is ${python.version}`,
      };
    }

    return { ok: true, reason: "" };
  }

  /** The release vpython's Python version and whether it is >= 3.11. */
  async function vpythonVersion(): Promise<{
    version: string;
    atLeast311: boolean;
  }> {
    const vpython = path.join(process.env.VECTORCAST_DIR ?? "", "vpython");
    try {
      // Parse a marker rather than raw stdout: vpython can print a banner (e.g.
      // a VECTORCAST_DIR mismatch warning) before the version.
      const { stdout, stderr } = await promisifiedExec(
        `"${vpython}" -c "import sys; print('PYVER=%d.%d' % sys.version_info[:2])"`
      );
      const match = /PYVER=(\d+)\.(\d+)/.exec(`${stdout}\n${stderr}`);
      if (!match) return { version: "unknown", atLeast311: false };
      const major = Number(match[1]);
      const minor = Number(match[2]);
      return {
        version: `${major}.${minor}`,
        atLeast311: major > 3 || (major === 3 && minor >= 11),
      };
    } catch {
      return { version: "unknown", atLeast311: false };
    }
  }

  async function setAzureSetting(title: string, value: string) {
    console.log(`Setting Reqs2x › Azure › ${title}`);
    const settingsEditor = await workbench.openSettings();
    const setting = await settingsEditor.findSetting(
      title,
      "Vectorcast Test Explorer › Reqs2x › Azure"
    );
    await setting.setValue(value);
    await workbench.getEditorView().closeAllEditors();
  }
});
