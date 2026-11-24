// Test/specs/vcast_requirements_review.test.ts
import path from "node:path";
import { exec } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  type BottomBarPanel,
  type TreeItem,
  type Workbench,
} from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  findSubprogram,
  findSubprogramMethod,
  getTestHandle,
  getViewContent,
  updateTestID,
  TIMEOUT,
} from "../test_utils/vcast_utils";

const run = promisify(exec);

// Progress in the runner's log, to tell where a failing run got to.
const step = (text: string) => console.log(`[requirements review] ${text}`);

// The report's units, functions and tests start collapsed, and collapsed
// content is neither in the page's text nor clickable: open everything.
async function expandReport() {
  await browser.execute(() => {
    for (const details of document.querySelectorAll("details")) {
      details.open = true;
    }
  });
}

// The report of the last check of several tests, with everything open.
// Returns its webview, to close it again.
async function openCheckReport(workbench: Workbench) {
  await browser.executeWorkbench(async (vscode) => {
    await vscode.commands.executeCommand(
      "vectorcastTestExplorer.showRequirementsCheckReport"
    );
  });
  const webview = (await workbench.getAllWebviews())[0];
  await webview.open();
  await expandReport();
  return webview;
}
const reviewDir = path.join(__dirname, "..", "vcastTutorial", "review_c");

// Both tests are traced to the steak requirement; only the first orders steak.
// The third test is linked to no requirement to check the hover in the title.
const requirementsCsv = `Key,ID,Module,Title,Description,Function
Place_Order.2,Place_Order.2,manager,Steak adds $14.00,The system shall increase the check total by $14.00 when steak is selected as the entree in the order.,Place_Order
`;
const notes = `TEST.NOTES:
This test validates that selecting steak as the entree increases the check total by $14.00.
TEST.END_NOTES:`;
const linkedTests = `-- Test Case Script
TEST.UNIT:manager
TEST.SUBPROGRAM:Place_Order
TEST.NEW
TEST.NAME:PLACE_ORDER_STEAK
TEST.REQUIREMENT_KEY:Place_Order.2
TEST.VALUE:manager.Place_Order.Table:1
TEST.VALUE:manager.Place_Order.Seat:0
TEST.VALUE:manager.Place_Order.Order.Entree:STEAK
TEST.VALUE:uut_prototype_stubs.Get_Table_Record.return.Check_Total:0.0
TEST.EXPECTED:uut_prototype_stubs.Update_Table_Record.Data.Check_Total:14.0
${notes}
TEST.END
TEST.NEW
TEST.NAME:PLACE_ORDER_CHICKEN
TEST.REQUIREMENT_KEY:Place_Order.2
TEST.VALUE:manager.Place_Order.Table:1
TEST.VALUE:manager.Place_Order.Seat:0
TEST.VALUE:manager.Place_Order.Order.Entree:CHICKEN
TEST.VALUE:uut_prototype_stubs.Get_Table_Record.return.Check_Total:0.0
TEST.EXPECTED:uut_prototype_stubs.Update_Table_Record.Data.Check_Total:10.0
${notes}
TEST.END
TEST.NEW
TEST.NAME:PLACE_ORDER_UNLINKED
TEST.VALUE:manager.Place_Order.Table:1
TEST.VALUE:manager.Place_Order.Seat:0
TEST.VALUE:manager.Place_Order.Order.Entree:STEAK
TEST.END
`;

async function clicast(...args: string[]) {
  await run(`"${process.env.VECTORCAST_DIR}/clicast" ${args.join(" ")}`, {
    cwd: reviewDir,
  });
}

// The text of the review comment for this test, or "" if there is none.
async function reviewCommentText(testName: string): Promise<string> {
  for (const thread of await $$(".review-widget")) {
    const text = await thread.getText();
    if (text.includes(testName)) return text;
  }
  return "";
}

// "Mark as reviewed" in a review's comment (the button of a single test, the
// link of each test of a function) and the "Undo" of a marked test, by what
// they say on hover.
const MARK_AS_REVIEWED = "a[title='You reviewed this test']";
const UNDO_REVIEWED = "a[title='Take the reviewed mark back']";

// Waits until the review comment for `name` has (or, with `shown` false, no
// longer has) the text.
async function waitForReviewComment(name: string, text: string, shown = true) {
  await browser.waitUntil(
    async () => (await reviewCommentText(name)).includes(text) === shown,
    {
      timeout: TIMEOUT,
      timeoutMsg: `The review of ${name} ${shown ? "does not say" : "still says"}: ${text}`,
    }
  );
}

// Shows the reviewed source again, and with it the review's comment, after
// the report took its place in the editor.
async function showReviewedSource() {
  await browser.executeWorkbench(async (vscode) => {
    const source = vscode.workspace.textDocuments.find((document) =>
      document.fileName.endsWith("manager.c")
    );
    if (!source) throw new Error("manager.c is not open");
    await vscode.window.showTextDocument(source, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
    });
  });
}

async function visibleEditors(): Promise<string> {
  return browser.executeWorkbench((vscode) =>
    vscode.window.visibleTextEditors
      .map((editor) => editor.document.uri.toString())
      .join(", ")
  );
}

// The VectorCAST submenu of the test, or of the Place_Order function when
// no test name is given.
async function openVectorcastMenuFor(testName?: string) {
  step(`opening the VectorCAST menu of ${testName ?? "Place_Order"}`);
  const vcastTestingViewContent = await getViewContent("Testing");
  let handle: TreeItem;
  for (const section of await vcastTestingViewContent.getSections()) {
    const subprogram = await findSubprogram("manager", section);
    if (subprogram) {
      await subprogram.expand();
      handle = testName
        ? await getTestHandle(subprogram, "Place_Order", testName, 3)
        : await findSubprogramMethod(subprogram, "Place_Order");
      if (handle) break;
    }
  }
  if (!handle) throw new Error(`${testName ?? "Place_Order"} not found`);

  const contextMenu = await handle.openContextMenu();
  await contextMenu.select("VectorCAST");
}

// "Focus Requirements Check On..." in the review's title, then the quick pick
// entry whose name is typed.
async function focusReviewOn(name: string) {
  step(`focusing the review on ${name}`);
  await (await $("aria/Focus Requirements Check On...")).click();
  await (await $(".quick-input-widget")).waitForDisplayed({ timeout: TIMEOUT });
  await browser.keys(name);
  await browser.waitUntil(
    async () =>
      (await $(".quick-input-list .monaco-list-row").getText()).includes(name),
    { timeout: TIMEOUT }
  );
  await browser.keys(Key.Enter);
}

// The hover of the line of the reviewed source that contains `text`.
async function hoverSourceLine(text: string): Promise<string> {
  step(`hovering the source line with ${text}`);
  // The reviewed source, wherever it is: after a single-test review the
  // test script beside it has the focus.
  await browser.executeWorkbench(async (vscode, wanted: string) => {
    const editor = vscode.window.visibleTextEditors.find((candidate) =>
      candidate.document.fileName.endsWith("manager.c")
    );
    if (!editor) throw new Error("manager.c is not open");
    const line = editor.document
      .getText()
      .split("\n")
      .findIndex((l: string) => l.includes(wanted));
    if (line < 0) throw new Error(`${wanted} is not in manager.c`);
    const shown = await vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
    });
    shown.revealRange(
      new vscode.Range(line, 0, line, 0),
      vscode.TextEditorRevealType.InCenter
    );
  }, text);
  const token = await $(`.view-line*=${text}`).$("span");
  await token.moveTo();
  await browser.waitUntil(
    async () => (await $(".monaco-hover").getText()).includes("Ran by"),
    { timeout: TIMEOUT }
  );
  return $(".monaco-hover").getText();
}

// Edits the test script the review opened beside the source, as a user
// would, and saves it, which loads it into the environment.
async function editReviewScript(replacements: [string, string][]) {
  step(`editing the test script: ${JSON.stringify(replacements)}`);
  // The open script shows the focused test once it holds the text to replace.
  await browser.waitUntil(
    async () =>
      browser.executeWorkbench((vscode, pairs: [string, string][]) => {
        const document = vscode.workspace.textDocuments.find((d) =>
          d.fileName.endsWith("TUTORIAL_C.tst")
        );
        const text: string = document?.getText() ?? "";
        return pairs.every(([from]) => text.includes(from));
      }, replacements),
    { timeout: TIMEOUT }
  );
  await browser.executeWorkbench(async (vscode, pairs: [string, string][]) => {
    const document = vscode.workspace.textDocuments.find((d) =>
      d.fileName.endsWith("TUTORIAL_C.tst")
    );
    let text = document.getText();
    for (const [from, to] of pairs) text = text.replace(from, to);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      text
    );
    await vscode.workspace.applyEdit(edit);
    // The save handler loads the script of the active editor.
    await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: false,
    });
    await document.save();
  }, replacements);
}

async function openReviewFor(testName: string) {
  await openVectorcastMenuFor(testName);
  step(`checking ${testName} against requirements`);
  await (await $("aria/Check Test Against Requirements")).click();

  try {
    await browser.waitUntil(
      async () => (await reviewCommentText(testName)).includes("Verdict:"),
      { timeout: 240_000 }
    );
  } catch {
    throw new Error(
      `No review comment for ${testName}; visible: ${await visibleEditors()}`
    );
  }
}

describe("Requirements check", () => {
  let workbench: Workbench;
  let bottomBar: BottomBarPanel;

  before(async () => {
    workbench = await browser.getWorkbench();
    bottomBar = workbench.getBottomBar();
    await bottomBar.toggle(true);
    process.env.E2E_TEST_ID = "0";

    // TUTORIAL_C with a CSV requirements gateway, the linked tests loaded and
    // executed, which is the state a review needs.
    await mkdir(reviewDir, { recursive: true });
    await writeFile(path.join(reviewDir, "reqs.csv"), requirementsCsv);
    await writeFile(path.join(reviewDir, "linked_tests.tst"), linkedTests);
    await clicast("-lc", "template", "GNU_C_X");
    await clicast(
      "-lc",
      "environment",
      "script",
      "run",
      `"${process.env.VECTORCAST_DIR}/tutorial/c/TUTORIAL_C.env"`
    );
    await clicast("-lc", "option", "VCAST_REPOSITORY", reviewDir);
    await clicast("-lc", "RGw", "INitialize");
    await clicast("-lc", "Rgw", "Set", "Gateway", "CSV");
    for (const [name, value] of [
      ["csv_path", "reqs.csv"],
      ["use_attribute_filter", "0"],
      ["id_attribute", "ID"],
      ["key_attribute", "Key"],
      ["title_attribute", "Title"],
      ["description_attribute", "Description"],
    ]) {
      await clicast("-lc", "RGw", "Configure", "Set", "CSV", name, value);
    }
    await clicast("-lc", "RGw", "Import");
    await clicast(
      "-e",
      "TUTORIAL_C",
      "test",
      "script",
      "run",
      "linked_tests.tst"
    );
    await clicast("-e", "TUTORIAL_C", "execute", "batch");

    await browser.executeWorkbench(
      async (vscode, settings: Record<string, unknown>) => {
        const config = vscode.workspace.getConfiguration(
          "vectorcastTestExplorer"
        );
        for (const [key, value] of Object.entries(settings)) {
          await config.update(key, value, vscode.ConfigurationTarget.Global);
        }
      },
      {
        "reqs2x.installationLocation": process.env.REQS2TESTS_RESOURCES,
        "reqs2x.enableReqs2xFeature": true,
        "reqs2x.provider": "azure_openai",
        "reqs2x.azure.apiKey": process.env.OPENAI_API_KEY,
        "reqs2x.azure.baseUrl": process.env.AZURE_BASE_URL,
        "reqs2x.azure.deployment":
          process.env.AZURE_DEPLOYMENT ?? "gpt-4.1-mini",
        "reqs2x.azure.modelName":
          process.env.AZURE_DEPLOYMENT ?? "gpt-4.1-mini",
      }
    );
  });

  it("should activate vcastAdapter", async () => {
    await updateTestID();
    await browser.keys([Key.Control, Key.Shift, "p"]);
    for (const character of "vector") {
      await browser.keys(character);
    }
    await browser.keys(Key.Enter);

    const activityBar = workbench.getActivityBar();
    await $("aria/VectorCAST Test Pane Initialization");
    await browser.waitUntil(
      async () => (await activityBar.getViewControl("Testing")) !== undefined,
      { timeout: TIMEOUT }
    );
    const testingView = await activityBar.getViewControl("Testing");
    await testingView?.openView();

    // In the requirements group the workspace already holds an environment
    // from the earlier specs, so the extension activated at startup and
    // scanned before the hook above built TUTORIAL_C: scan again.
    step("refreshing the test tree so that TUTORIAL_C is picked up");
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand("testing.refreshTests");
    });
    await browser.waitUntil(
      async () => await $("aria/TUTORIAL_C").isExisting(),
      {
        timeout: TIMEOUT,
        timeoutMsg: "TUTORIAL_C did not appear in the test tree",
      }
    );
  });

  it("should say why a test without linked requirements cannot be checked", async () => {
    await updateTestID();
    await openVectorcastMenuFor("PLACE_ORDER_UNLINKED");
    await (await $("aria/Check Test Against Requirements")).click();

    const reason =
      "Cannot check PLACE_ORDER_UNLINKED: None of the selected tests is linked to a requirement.";
    await browser.waitUntil(
      async () => {
        for (const notification of await workbench.getNotifications()) {
          if ((await notification.getMessage()).includes(reason)) {
            await notification.dismiss();
            return true;
          }
        }
        return false;
      },
      { timeout: 120_000, timeoutMsg: `No notification: ${reason}` }
    );
  });

  it("should pass a test that checks its requirement", async () => {
    await updateTestID();
    await openReviewFor("PLACE_ORDER_STEAK");

    expect(await reviewCommentText("PLACE_ORDER_STEAK")).toContain(
      "Verdict: PASS"
    );
    const sourceOpen = await browser.executeWorkbench((vscode) =>
      vscode.window.visibleTextEditors.some((editor) =>
        editor.document.fileName.endsWith("manager.c")
      )
    );
    expect(sourceOpen).toBe(true);

    await (await $("aria/Close Requirements Check")).click();
    await browser.waitUntil(
      async () => (await $$(".review-widget")).length === 0,
      { timeout: TIMEOUT }
    );
  });

  it("should fail a test traced to a requirement it does not check", async () => {
    await updateTestID();
    await openReviewFor("PLACE_ORDER_CHICKEN");

    expect(await reviewCommentText("PLACE_ORDER_CHICKEN")).toContain(
      "Verdict: FAIL"
    );
  });

  it("should replace the previous review rather than open more columns and comments", async () => {
    await updateTestID();
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand("workbench.action.closeAllGroups");
    });
    await openReviewFor("PLACE_ORDER_STEAK");
    await openReviewFor("PLACE_ORDER_CHICKEN");

    const columns = await browser.executeWorkbench(
      (vscode) => vscode.window.tabGroups.all.length
    );
    expect(columns).toBe(2);
    const comments = await $$(".review-widget");
    expect(comments).toHaveLength(1);
    expect(await comments[0].getText()).toContain("PLACE_ORDER_CHICKEN");
  });

  it("should check every linked test of a function at once and report the verdicts by function", async () => {
    await updateTestID();
    await (await $("aria/Close Requirements Check")).click();
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand("workbench.action.closeAllGroups");
    });

    await openVectorcastMenuFor();
    step("checking all tests of Place_Order against requirements");
    await (await $("aria/Check Tests Against Requirements")).click();

    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: 480_000 }
    );
    step("report opened");
    const webview = (await workbench.getAllWebviews())[0];
    await webview.open();
    await expandReport();
    const report = await $("body").getText();
    expect(report).toContain("Requirements check: Place_Order");
    expect(report).toContain("manager 1 passed, 1 failed");
    expect(report).toContain("Place_Order 1 passed, 1 failed");
    expect(report).toContain("PLACE_ORDER_STEAK");
    expect(report).toContain("PLACE_ORDER_CHICKEN");
    // The unlinked test has nothing to check, so it is not in the report,
    // which says so.
    expect(report).not.toContain("PLACE_ORDER_UNLINKED");
    expect(report).toContain(
      "1 test without a linked requirement was not checked."
    );
    // Hovering the note names them.
    expect(await $(".unchecked").getAttribute("title")).toBe(
      "PLACE_ORDER_UNLINKED"
    );

    // Each verdict opens the single-test review.
    step("opening the review of PLACE_ORDER_CHICKEN from the report");
    await (await $("details*=PLACE_ORDER_CHICKEN").$("button.open")).click();
    await webview.close();
    await browser.waitUntil(
      async () =>
        (await reviewCommentText("PLACE_ORDER_CHICKEN")).includes(
          "Verdict: FAIL"
        ),
      { timeout: TIMEOUT }
    );
  });

  it("should review all tests of a function together from the report", async () => {
    await updateTestID();
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand(
        "vectorcastTestExplorer.showRequirementsCheckReport"
      );
    });
    const webview = (await workbench.getAllWebviews())[0];
    await webview.open();
    await expandReport();
    step("reviewing Place_Order as a whole from the report");
    await (await $("details.function > summary button.group")).click();
    await webview.close();

    await browser.waitUntil(
      async () =>
        (await reviewCommentText("Place_Order")).includes("1 passed, 1 failed"),
      { timeout: TIMEOUT }
    );
    // The group comment's table: verdict, test, requirements per row.
    const thread = await reviewCommentText("Place_Order");
    expect(thread).toMatch(/PASS\s+PLACE_ORDER_STEAK\s+.*Place_Order\.2/);
    expect(thread).toMatch(/FAIL\s+PLACE_ORDER_CHICKEN\s+.*Place_Order\.2/);
  });

  it("should focus the review on one of its tests and back on the function", async () => {
    await updateTestID();
    await focusReviewOn("PLACE_ORDER_STEAK");
    await browser.waitUntil(
      async () =>
        (await reviewCommentText("PLACE_ORDER_STEAK")).includes(
          "Verdict: PASS"
        ),
      { timeout: TIMEOUT }
    );
    expect(await $$(".review-widget")).toHaveLength(1);
    expect(await reviewCommentText("PLACE_ORDER_STEAK")).toContain(
      "Focus on: PLACE_ORDER_STEAK"
    );

    // The swap icon next to "Focus on" opens the same picker.
    await (await $("a[title^='Change the unit, function or test']")).click();
    await (
      await $(".quick-input-widget")
    ).waitForDisplayed({ timeout: TIMEOUT });
    await browser.keys("manager.Place_Order");
    await browser.keys(Key.Enter);
    await browser.waitUntil(
      async () =>
        (await reviewCommentText("Place_Order")).includes("1 passed, 1 failed"),
      { timeout: TIMEOUT }
    );
  });

  it("should say on hover which reviewed tests ran a line and open that test from it", async () => {
    await updateTestID();
    // Only the steak test runs the steak case.
    const hover = await hoverSourceLine("COST_OF_STEAK");
    expect(hover).toContain("Ran by");
    expect(hover).toContain("PLACE_ORDER_STEAK");
    expect(hover).not.toContain("PLACE_ORDER_CHICKEN");

    step("opening PLACE_ORDER_STEAK from the hover");
    // Text selectors cannot follow a CSS combinator, so find the hover
    // first and the link inside it.
    await (await $(".monaco-hover").$("a*=PLACE_ORDER_STEAK")).click();
    await browser.waitUntil(
      async () =>
        (await reviewCommentText("PLACE_ORDER_STEAK")).includes(
          "Focus on: PLACE_ORDER_STEAK"
        ),
      { timeout: TIMEOUT }
    );
    expect(await $$(".review-widget")).toHaveLength(1);
  });

  it("should mark a test as reviewed in its review and take the mark back", async () => {
    await updateTestID();
    // The review is still focused on the steak test.
    expect(await reviewCommentText("PLACE_ORDER_STEAK")).toContain(
      "Mark as reviewed"
    );
    step("clicking Mark as reviewed in the review of PLACE_ORDER_STEAK");
    await (await $(MARK_AS_REVIEWED)).click();
    await waitForReviewComment(
      "PLACE_ORDER_STEAK",
      "You marked this test as reviewed"
    );
    // The mark takes the place of the button, in the comment and its title.
    expect(await $(MARK_AS_REVIEWED).isExisting()).toBe(false);
    await browser.waitUntil(
      async () => !(await $("aria/Mark as Reviewed").isExisting()),
      { timeout: TIMEOUT }
    );

    step("clicking Undo");
    await (await $(UNDO_REVIEWED)).click();
    await waitForReviewComment("PLACE_ORDER_STEAK", "You marked", false);
    expect(await reviewCommentText("PLACE_ORDER_STEAK")).toContain(
      "Mark as reviewed"
    );

    // The button in the review's title marks the test too.
    step("clicking Mark as Reviewed in the title of the review");
    await (await $("aria/Mark as Reviewed")).click();
    await waitForReviewComment(
      "PLACE_ORDER_STEAK",
      "You marked this test as reviewed"
    );
    await (await $(UNDO_REVIEWED)).click();
    await waitForReviewComment("PLACE_ORDER_STEAK", "You marked", false);
  });

  it("should mark the tests of a function as reviewed one by one, in its review and from the test tree", async () => {
    await updateTestID();
    await focusReviewOn("manager.Place_Order");
    await waitForReviewComment("Place_Order", "0 of 2 reviewed");
    const row = (testName: string) => $(`tr*=${testName}`);

    // Each test has its own link in the review's table.
    step("clicking Mark as reviewed in the row of PLACE_ORDER_STEAK");
    await (await row("PLACE_ORDER_STEAK").$(MARK_AS_REVIEWED)).click();
    await waitForReviewComment("Place_Order", "1 of 2 reviewed");
    expect(await row("PLACE_ORDER_STEAK").getText()).toMatch(/Reviewed\s+Undo/);
    expect(await row("PLACE_ORDER_CHICKEN").getText()).toMatch(
      /Mark\s+as\s+reviewed/
    );

    // The menu of a marked test in the test tree takes the mark back.
    await openVectorcastMenuFor("PLACE_ORDER_STEAK");
    step("clicking Mark as Not Reviewed in the test tree");
    await (await $("aria/Mark as Not Reviewed")).click();
    await waitForReviewComment("Place_Order", "0 of 2 reviewed");
    expect(await row("PLACE_ORDER_STEAK").getText()).toMatch(
      /Mark\s+as\s+reviewed/
    );

    // The menu of a test that is not marked marks it, which the open review
    // then shows.
    await openVectorcastMenuFor("PLACE_ORDER_CHICKEN");
    expect(await $("aria/Mark as Not Reviewed").isExisting()).toBe(false);
    step("clicking Mark as Reviewed in the test tree");
    await (await $("aria/Mark as Reviewed")).click();
    await waitForReviewComment("Place_Order", "1 of 2 reviewed");
    expect(await row("PLACE_ORDER_CHICKEN").getText()).toMatch(
      /Reviewed\s+Undo/
    );
  });

  it("should mark tests as reviewed on the report, which counts them", async () => {
    await updateTestID();
    const webview = await openCheckReport(workbench);
    const markButton = (testName: string) =>
      $(`details*=${testName}`).$("button.mark-reviewed");
    const functionHeader = () => $("details.function > summary").getText();
    const waitForReviewed = async (count: number) =>
      browser.waitUntil(
        async () => (await functionHeader()).includes(`${count} of 2 reviewed`),
        {
          timeout: TIMEOUT,
          timeoutMsg: `Place_Order does not say: ${count} of 2 reviewed`,
        }
      );

    // The chicken test was marked in the test tree.
    await waitForReviewed(1);
    expect(await markButton("PLACE_ORDER_CHICKEN").getText()).toContain(
      "Reviewed"
    );
    expect(await markButton("PLACE_ORDER_STEAK").getText()).toBe(
      "Mark as reviewed"
    );

    step("clicking Mark as reviewed on PLACE_ORDER_STEAK in the report");
    await (await markButton("PLACE_ORDER_STEAK")).click();
    await waitForReviewed(2);
    expect(await markButton("PLACE_ORDER_STEAK").getText()).toContain(
      "Reviewed"
    );

    // The button of a marked test takes the mark back.
    step("clicking the Reviewed button of both tests in the report");
    await (await markButton("PLACE_ORDER_STEAK")).click();
    await waitForReviewed(1);
    await (await markButton("PLACE_ORDER_CHICKEN")).click();
    await waitForReviewed(0);
    expect(await markButton("PLACE_ORDER_CHICKEN").getText()).toBe(
      "Mark as reviewed"
    );
    await webview.close();

    // The open review follows the report.
    await showReviewedSource();
    await waitForReviewComment("Place_Order", "0 of 2 reviewed");
  });

  it("should still offer to change the focus in a review opened after another was closed", async () => {
    await updateTestID();
    await (await $("aria/Close Requirements Check")).click();
    await browser.waitUntil(
      async () => (await $$(".review-widget")).length === 0,
      { timeout: TIMEOUT }
    );

    const webview = await openCheckReport(workbench);
    step("reviewing Place_Order from the report after closing its review");
    await (await $("details.function > summary button.group")).click();
    await webview.close();
    await waitForReviewComment("Place_Order", "1 passed, 1 failed");
    expect(await reviewCommentText("Place_Order")).toContain(
      "Focus on: manager.Place_Order"
    );
    expect(await $("aria/Focus Requirements Check On...").isExisting()).toBe(
      true
    );
  });

  it("should flag a changed test, refresh its coverage and re-run its check", async () => {
    await updateTestID();
    await focusReviewOn("PLACE_ORDER_CHICKEN");
    await browser.waitUntil(
      async () =>
        (await reviewCommentText("PLACE_ORDER_CHICKEN")).includes(
          "Verdict: FAIL"
        ),
      { timeout: TIMEOUT }
    );

    // The chicken test now orders steak and expects its price: it changed,
    // and it would check the steak requirement.
    step("changing PLACE_ORDER_CHICKEN to order steak");
    await editReviewScript([
      ["Order.Entree:CHICKEN", "Order.Entree:STEAK"],
      ["Check_Total:10.0", "Check_Total:14.0"],
    ]);
    await browser.waitUntil(
      async () =>
        (await reviewCommentText("PLACE_ORDER_CHICKEN")).includes(
          "Out of date"
        ),
      { timeout: TIMEOUT }
    );
    let comment = await reviewCommentText("PLACE_ORDER_CHICKEN");
    expect(comment).toContain("PLACE_ORDER_CHICKEN changed since this check");
    expect(comment).toContain("Re-run the test");
    expect(comment).toContain("Re-run test check against requirements");

    // Re-running the test refreshes the coverage, not the verdict.
    step("clicking Re-run the test");
    await (await $("a[title^='Run the tests again']")).click();
    await browser.waitUntil(
      async () =>
        (await reviewCommentText("PLACE_ORDER_CHICKEN")).includes(
          "Coverage refreshed"
        ),
      { timeout: TIMEOUT }
    );
    comment = await reviewCommentText("PLACE_ORDER_CHICKEN");
    expect(comment).not.toContain("Out of date");
    expect(comment).toContain("Verdict: FAIL");

    // Re-running the check judges the changed test anew: it passes now.
    step("clicking Re-run test check against requirements");
    await (await $("a[title^='Check again with tests2check']")).click();
    await browser.waitUntil(
      async () =>
        (await reviewCommentText("PLACE_ORDER_CHICKEN")).includes(
          "Verdict: PASS"
        ),
      { timeout: 240_000 }
    );
    comment = await reviewCommentText("PLACE_ORDER_CHICKEN");
    expect(comment).not.toContain("Coverage refreshed");
    expect(comment).not.toContain("Out of date");
  });

  it("should mark the changed test on the report and re-run the check from it", async () => {
    await updateTestID();
    const openReport = async () => openCheckReport(workbench);

    // The check re-run by the previous test refreshed the report, so the
    // chicken test changes again, on a value its requirement ignores.
    step("changing the seat of PLACE_ORDER_CHICKEN");
    await editReviewScript([["Seat:0", "Seat:1"]]);
    await browser.waitUntil(
      async () =>
        (await reviewCommentText("PLACE_ORDER_CHICKEN")).includes(
          "Out of date"
        ),
      { timeout: TIMEOUT }
    );

    // The report still shows the chicken test's old verdict.
    let webview = await openReport();
    let report = await $("body").getText();
    expect(report).toContain("Out of date: 1 test changed since this check.");
    expect(await $("details.test.stale").isExisting()).toBe(true);
    expect(await $("details.test.stale").getText()).toContain(
      "PLACE_ORDER_CHICKEN"
    );
    step("clicking Re-run check on the report");
    await (await $("button.rerun")).click();
    await webview.close();

    // The re-run replaces the report: both tests pass now, nothing is stale.
    await browser.waitUntil(
      async () => {
        webview = await openReport();
        report = await $("body").getText();
        await webview.close();
        return (
          report.includes("2 passed, 0 failed") &&
          !report.includes("Out of date")
        );
      },
      { timeout: 480_000, interval: 10_000 }
    );
    expect(report).not.toContain("Out of date");
    expect(report).not.toContain("changed since this check");
  });
});
