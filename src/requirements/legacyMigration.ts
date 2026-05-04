import * as vscode from "vscode";
import { findRelevantRequirementGateway } from "./rgwPath";
import { PANREQ_EXECUTABLE_PATH } from "./requirementsExecutables";
import { logCliOperation } from "./requirementsLog";
import { importRequirementsFromPath } from "./requirementsOperations";

const path = require("path");
const fs = require("fs");

// Persisted in workspaceState so a "Don't show again" choice survives
// across VS Code sessions for this workspace.
const SKIP_KEY = "vectorcastTestExplorer.reqs2x.skippedLegacyMigrationPrompt";

interface LegacyEnv {
  enviroPath: string;
  legacySource: string;
}

/**
 * Walk every `*.env` in the workspace looking for envs that have a legacy
 * `reqs-<env>/reqs.xlsx` (or `reqs.csv`) file but no RGW configured yet.
 * Those are the candidates for migration to the new RGW-based storage.
 */
async function findEnvsWithLegacyStorage(): Promise<LegacyEnv[]> {
  const envFiles = await vscode.workspace.findFiles("**/*.env");
  const out: LegacyEnv[] = [];
  for (const uri of envFiles) {
    const envDir = path.dirname(uri.fsPath);
    const envName = path.basename(uri.fsPath, ".env");
    const enviroPath = path.join(envDir, envName);

    // Already migrated (or otherwise has a working gateway): skip.
    if (findRelevantRequirementGateway(enviroPath)) continue;

    const reqsDir = path.join(envDir, `reqs-${envName}`);
    const xlsx = path.join(reqsDir, "reqs.xlsx");
    const csv = path.join(reqsDir, "reqs.csv");
    if (fs.existsSync(xlsx)) {
      out.push({ enviroPath, legacySource: xlsx });
    } else if (fs.existsSync(csv)) {
      out.push({ enviroPath, legacySource: csv });
    }
  }
  return out;
}

/**
 * Migrate one env: import its legacy reqs.xlsx / reqs.csv into a fresh RGW
 * under `reqs-<env>/rgw/`. Just a thin wrapper around the shared
 * importRequirementsFromPath helper with a migration-flavoured progress
 * title.
 */
async function migrateOne(env: LegacyEnv): Promise<boolean> {
  return importRequirementsFromPath(env.enviroPath, env.legacySource, {
    progressTitle: `Migrating requirements for ${path.basename(env.enviroPath)}`,
  });
}

/**
 * Offer a one-shot migration of legacy reqs.xlsx / reqs.csv files into the
 * new RGW format. Shown at most once per workspace per "Don't show again"
 * choice; otherwise the prompt re-appears the next session if any envs
 * still have legacy files but no gateway. Skipped entirely when Reqs2X
 * isn't enabled (the executables aren't resolved in that case).
 */
export async function maybeOfferLegacyMigration(
  context: vscode.ExtensionContext
): Promise<void> {
  if (context.workspaceState.get<boolean>(SKIP_KEY)) return;

  // Reqs2X feature must be on (so the panreq path is resolved).
  const enabled = vscode.workspace
    .getConfiguration("vectorcastTestExplorer.reqs2x")
    .get<boolean>("enableReqs2xFeature");
  if (!enabled || !PANREQ_EXECUTABLE_PATH) return;

  const legacyEnvs = await findEnvsWithLegacyStorage();
  if (legacyEnvs.length === 0) return;

  logCliOperation(
    `Legacy migration: ${legacyEnvs.length} env(s) have reqs.xlsx/reqs.csv but no RGW.`
  );

  const envWord = legacyEnvs.length === 1 ? "environment" : "environments";
  const message =
    `Found ${legacyEnvs.length} ${envWord} with legacy requirements files ` +
    `(reqs.xlsx / reqs.csv). Requirements are now stored in a Requirements ` +
    `Gateway (RGW). Migrate now?`;

  const choice = await vscode.window.showInformationMessage(
    message,
    "Migrate",
    "Not now",
    "Don't show again"
  );

  if (choice === "Don't show again") {
    await context.workspaceState.update(SKIP_KEY, true);
    return;
  }
  if (choice !== "Migrate") return;

  let succeeded = 0;
  let failed = 0;
  for (const env of legacyEnvs) {
    const ok = await migrateOne(env);
    if (ok) succeeded++;
    else failed++;
  }

  if (failed === 0) {
    vscode.window.showInformationMessage(
      `Migrated ${succeeded} ${envWord} to the new RGW format. ` +
      `The legacy reqs.xlsx / reqs.csv files were left in place as a backup.`
    );
  } else {
    vscode.window.showWarningMessage(
      `Migrated ${succeeded}; ${failed} failed. See the ` +
      `"VectorCAST Requirement Test Generation Operations" output channel for details.`
    );
  }
}
