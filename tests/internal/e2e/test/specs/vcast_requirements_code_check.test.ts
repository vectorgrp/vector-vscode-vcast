// Test/specs/vcast_requirements_code_check.test.ts
import path from "node:path";
import { exec } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { type TreeItem, type Workbench } from "wdio-vscode-service";
import { Key } from "webdriverio";
import {
  getViewContent,
  updateTestID,
  TIMEOUT,
} from "../test_utils/vcast_utils";

const run = promisify(exec);

// Progress in the runner's log, to tell where a failing run got to.
const step = (text: string) => console.log(`[code check] ${text}`);

const checkDir = path.join(__dirname, "..", "vcastTutorial", "code_check_c");
const tutorialDir = path.join(process.env.VECTORCAST_DIR, "tutorial", "c");
// Its own name: the requirements group has a TUTORIAL_C already.
const enviroName = "CODE_CHECK_C";

// Place_Order adds $14.00 for steak, as the first requirement says, and
// $18.00 for lobster, which the second one contradicts.
const requirementsCsv = `Key,ID,Module,Title,Description,Function
Place_Order.1,Place_Order.1,manager,Steak adds $14.00,The system shall increase the check total by $14.00 when steak is selected as the entree in the order.,Place_Order
Place_Order.2,Place_Order.2,manager,Lobster adds $25.00,The system shall increase the check total by $25.00 when lobster is selected as the entree in the order.,Place_Order
`;
// An imported gateway traces nothing; the check is of the functions that
// requirements are traced to.
const tracedToPlaceOrder = { unit: "manager", function: "Place_Order" };
const traceability = {
  "Place_Order.1": { ...tracedToPlaceOrder, lines: null },
  "Place_Order.2": { ...tracedToPlaceOrder, lines: null },
};

async function clicast(...args: string[]) {
  await run(`"${process.env.VECTORCAST_DIR}/clicast" ${args.join(" ")}`, {
    cwd: checkDir,
  });
}

// The node of the test tree at the end of the path of names, which starts at
// the environment.
async function treeNode(...names: string[]): Promise<TreeItem> {
  const labelOf = async (item: TreeItem) =>
    (await (await item.elem).getText()).split("\n")[0].trim();
  const content = await getViewContent("Testing");
  for (const section of await content.getSections()) {
    if (!(await section.isExpanded())) await section.expand();
    let candidates = (await section.getVisibleItems()) as TreeItem[];
    let node: TreeItem | undefined;
    for (const [depth, name] of names.entries()) {
      node = undefined;
      for (const candidate of candidates) {
        if ((await labelOf(candidate)) === name) node = candidate;
      }
      if (!node) break;
      if (depth < names.length - 1) {
        if (!(await node.isExpanded())) await node.expand();
        candidates = await node.getChildren();
      }
    }
    if (node) return node;
  }
  throw new Error(`${names.join(" > ")} is not in the test tree`);
}

async function checkCodeOf(...names: string[]) {
  step(`checking the code of ${names.join(" > ")} against its requirements`);
  const contextMenu = await (await treeNode(...names)).openContextMenu();
  await contextMenu.select("VectorCAST");
  await (await $("aria/Check Code Against Requirements")).click();
}

// The text of the comments on the function's findings, or "" if there are none.
async function findingsCommentText(functionName: string): Promise<string> {
  for (const thread of await $$(".review-widget")) {
    const text = await thread.getText();
    if (text.includes(functionName)) return text;
  }
  return "";
}

describe("Code check against requirements", () => {
  let workbench: Workbench;

  // Shows the report, runs `inReport` inside its page and leaves the page
  // again. The page is rendered anew whenever the check changes, so it is
  // entered each time.
  async function withReport<T>(inReport: () => Promise<T>): Promise<T> {
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand(
        "vectorcastTestExplorer.showCodeCheckReport"
      );
    });
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );
    const webview = (await workbench.getAllWebviews())[0];
    await webview.open();
    try {
      return await inReport();
    } finally {
      await webview.close();
    }
  }

  const reportText = async () => withReport(async () => $("body").getText());

  before(async () => {
    workbench = await browser.getWorkbench();
    await workbench.getBottomBar().toggle(true);
    process.env.E2E_TEST_ID = "0";

    // The C tutorial under its own name, with a CSV requirements gateway
    // whose two requirements are traced to Place_Order.
    await mkdir(checkDir, { recursive: true });
    const enviroScript = await readFile(
      path.join(tutorialDir, "TUTORIAL_C.env"),
      "utf8"
    );
    await writeFile(
      path.join(checkDir, `${enviroName}.env`),
      enviroScript.replace("TUTORIAL_C", enviroName)
    );
    await writeFile(path.join(checkDir, "reqs.csv"), requirementsCsv);
    await clicast("-lc", "template", "GNU_C_X");
    await clicast("-lc", "environment", "script", "run", `${enviroName}.env`);
    await clicast("-lc", "option", "VCAST_REPOSITORY", checkDir);
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
    await writeFile(
      path.join(checkDir, "requirements_gateway", "traceability.json"),
      JSON.stringify(traceability)
    );

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

    // In the requirements group the extension activated at startup and
    // scanned before the hook above built the environment: scan again.
    step(`refreshing the test tree so that ${enviroName} is picked up`);
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand("testing.refreshTests");
    });
    await browser.waitUntil(
      async () => await $(`aria/${enviroName}`).isExisting(),
      {
        timeout: TIMEOUT,
        timeoutMsg: `${enviroName} did not appear in the test tree`,
      }
    );
  });

  it("should show the findings of a function as comments in its code", async () => {
    await updateTestID();
    await checkCodeOf(enviroName, "manager", "Place_Order");

    await browser.waitUntil(
      async () =>
        (await findingsCommentText("Place_Order")).includes(
          "Violates requirement"
        ),
      {
        timeout: 240_000,
        timeoutMsg: "No comment on a violated requirement of Place_Order",
      }
    );
    const comments = await findingsCommentText("Place_Order");
    // The violated requirement, quoted
    expect(comments).toContain("Place_Order.2");
    expect(comments).toContain("$25.00 when lobster is selected");
    expect(comments).toContain("AI-generated requirements check.");
    const sourceOpen = await browser.executeWorkbench((vscode) =>
      vscode.window.visibleTextEditors.some((editor) =>
        editor.document.fileName.endsWith("manager.c")
      )
    );
    expect(sourceOpen).toBe(true);
  });

  it("should report the checked functions of an environment by unit", async () => {
    await updateTestID();
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand("workbench.action.closeAllGroups");
    });
    await checkCodeOf(enviroName);

    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: 480_000, timeoutMsg: "The report did not open" }
    );
    step("report opened");
    await withReport(async () => {
      const report = await $("body").getText();
      expect(report).toContain(`Code against requirements: ${enviroName}`);
      // Only Place_Order has requirements traced to it.
      expect(report).toContain("1 function checked:");
      expect(report).toContain("manager 1 function,");
      expect(report).toContain("Place_Order.1");
      // The finding is under the requirement it is about.
      const violated = await $("section.requirement*=Place_Order.2");
      expect(await violated.$(".mark.fail").isExisting()).toBe(true);
      expect(await violated.$(".kind.violation").getText()).toBe(
        "Violates requirement"
      );
    });
  });

  it("should show how the requirements fared in the requirements editor", async () => {
    await updateTestID();
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand("workbench.action.closeAllGroups");
    });
    const contextMenu = await (await treeNode(enviroName)).openContextMenu();
    await contextMenu.select("VectorCAST");
    await (await $("aria/Show Requirements")).click();
    await browser.waitUntil(
      async () => (await workbench.getAllWebviews()).length > 0,
      { timeout: TIMEOUT }
    );

    const webview = (await workbench.getAllWebviews())[0];
    await webview.open();
    const chipOf = (key: string) => $(`.req[data-req-id="${key}"] .req-check`);
    await (
      await chipOf("Place_Order.2")
    ).waitForDisplayed({ timeout: TIMEOUT });
    expect(await chipOf("Place_Order.2").getText()).toContain("Violated");
    expect(await chipOf("Place_Order.2").getAttribute("class")).toContain(
      "req-check--violated"
    );
    expect(await $("#check-code-btn").isExisting()).toBe(true);

    step("showing the violated requirement's function from its chip");
    await (await chipOf("Place_Order.2")).click();
    await webview.close();
    await browser.waitUntil(
      async () =>
        (await findingsCommentText("Place_Order")).includes("Place_Order.2"),
      { timeout: TIMEOUT }
    );
  });

  it("should strike out a dismissed finding and bring it back", async () => {
    await updateTestID();
    await browser.executeWorkbench(async (vscode) => {
      await vscode.commands.executeCommand("workbench.action.closeAllGroups");
    });
    const violationButton = (action: string) =>
      $("section.requirement*=Place_Order.2").$(
        `button[data-action="${action}"]`
      );

    step("dismissing the violation in the report");
    await withReport(async () => (await violationButton("dismiss")).click());
    await browser.waitUntil(
      async () => (await reportText()).includes("1 dismissed"),
      { timeout: TIMEOUT }
    );
    await withReport(async () => {
      const violated = await $("section.requirement*=Place_Order.2");
      expect(await violated.$(".finding.dismissed").isExisting()).toBe(true);
      // Nothing counts against the requirement any more.
      expect(await violated.$(".mark.pass").isExisting()).toBe(true);
      await (await violationButton("restore")).click();
    });
    await browser.waitUntil(
      async () => !(await reportText()).includes("dismissed"),
      { timeout: TIMEOUT }
    );
  });

  it("should say that a function is out of date once its code is edited", async () => {
    await updateTestID();
    const managerPath = path.join(tutorialDir, "manager.c");
    expect(await reportText()).not.toContain("Out of date");

    step("editing manager.c without saving it");
    await browser.executeWorkbench(async (vscode, file: string) => {
      const document = await vscode.workspace.openTextDocument(file);
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, new vscode.Position(0, 0), "/* edited */\n");
      await vscode.workspace.applyEdit(edit);
    }, managerPath);

    await browser.waitUntil(
      async () =>
        (await reportText()).includes(
          "Out of date: the code or the requirements of 1 function changed since the check."
        ),
      { timeout: TIMEOUT }
    );

    // The tutorial's source stays as it is.
    await browser.executeWorkbench(async (vscode, file: string) => {
      const document = await vscode.workspace.openTextDocument(file);
      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand("workbench.action.files.revert");
    }, managerPath);
  });
});
