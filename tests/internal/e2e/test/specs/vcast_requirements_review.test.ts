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
  getTestHandle,
  getViewContent,
  updateTestID,
  TIMEOUT,
} from "../test_utils/vcast_utils";

const run = promisify(exec);
const reviewDir = path.join(__dirname, "..", "vcastTutorial", "review_c");

// Both tests are traced to the steak requirement; only the first orders steak.
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

async function visibleEditors(): Promise<string> {
  return browser.executeWorkbench((vscode) =>
    vscode.window.visibleTextEditors
      .map((editor) => editor.document.uri.toString())
      .join(", ")
  );
}

async function openReviewFor(testName: string) {
  const vcastTestingViewContent = await getViewContent("Testing");
  let testHandle: TreeItem;
  for (const section of await vcastTestingViewContent.getSections()) {
    const subprogram = await findSubprogram("manager", section);
    if (subprogram) {
      await subprogram.expand();
      testHandle = await getTestHandle(subprogram, "Place_Order", testName, 2);
      if (testHandle) break;
    }
  }
  if (!testHandle) throw new Error(`Test ${testName} not found`);

  const contextMenu = await testHandle.openContextMenu();
  await contextMenu.select("VectorCAST");
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
        "reqs2x.enableReqs2xFeature": true,
        "reqs2x.enableRequirementsCoverageReview": true,
        "reqs2x.installationLocation": process.env.REQS2TESTS_RESOURCES,
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
});
