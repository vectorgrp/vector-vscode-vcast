import * as vscode from "vscode";
import { findRelevantRequirementGateway } from "./rgwPath";
import { logCliOperation } from "./requirementsLog";
import {
  importRequirementsFromPath,
  reqs2xUsable,
} from "./requirementsOperations";
import { vcastEnviroFile } from "../vcastTestInterface";
import { makeEnviroNodeID } from "../testPane";
import { normalizePath } from "../utilities";

const path = require("path");
const fs = require("fs");

// Persisted in workspaceState so a "Don't show again" choice survives
// across VS Code sessions for this workspace.
const SKIP_KEY = "vectorcastTestExplorer.reqs2x.skippedLegacyMigrationPrompt";

interface LegacyEnv {
  enviroPath: string;
  legacySource: string;
}

type MigrationOutcome = "migrated" | "failed" | "cancelled";

/** A built env directory contains UNITDATA.VCD; panreq can't import into an
 *  unbuilt one (the RGW clicast commands require a built environment). */
function isEnvBuilt(enviroPath: string): boolean {
  return fs.existsSync(path.join(enviroPath, vcastEnviroFile));
}

/** The `reqs-<env>` directory that holds legacy reqs.xlsx / reqs.csv. */
function legacyReqsDir(enviroPath: string): string {
  return path.join(
    path.dirname(enviroPath),
    `reqs-${path.basename(enviroPath)}`
  );
}

/** The tree-item / context-key node id for an env (matches testPane). */
function envNodeId(enviroPath: string): string {
  return makeEnviroNodeID(normalizePath(enviroPath));
}

/**
 * Build the migration candidate for one env, or null if it isn't one: unbuilt
 * (panreq would die importing into it) or no `reqs-<env>/reqs.xlsx`/`reqs.csv`
 * present. Envs that already have an RGW are still candidates so leftover files
 * can be cleaned up; how an existing RGW is resolved is decided in migrateOne.
 */
function legacyEnvFor(enviroPath: string): LegacyEnv | null {
  if (!isEnvBuilt(enviroPath)) return null;

  const reqsDir = legacyReqsDir(enviroPath);
  const xlsx = path.join(reqsDir, "reqs.xlsx");
  const csv = path.join(reqsDir, "reqs.csv");
  const legacySource = fs.existsSync(xlsx)
    ? xlsx
    : fs.existsSync(csv)
      ? csv
      : null;
  if (!legacySource) return null;

  return { enviroPath, legacySource };
}

/** Map a workspace `*.env` URI to its env path (build directory). */
function enviroPathFromEnvUri(uri: vscode.Uri): string {
  return path.join(path.dirname(uri.fsPath), path.basename(uri.fsPath, ".env"));
}

/** Every built env in the workspace that still has a legacy reqs file. */
async function findEnvsWithLegacyStorage(): Promise<LegacyEnv[]> {
  const envFiles = await vscode.workspace.findFiles("**/*.env");
  const out: LegacyEnv[] = [];
  for (const uri of envFiles) {
    const env = legacyEnvFor(enviroPathFromEnvUri(uri));
    if (env) out.push(env);
  }
  return out;
}

// ---------- Context key (drives menu visibility + gating) -------------------

/**
 * Recompute the `vcastLegacyMigrationAvailable` context key from disk — every
 * env that still has a legacy reqs file. It both shows the "Migrate Legacy
 * Requirements" menu entry and blocks the other requirements actions (generate,
 * import, …) for that env, so a leftover legacy file must be resolved before
 * requirements features are usable. Cheap (a few `existsSync` per env), so we
 * just rescan everything rather than tracking which env changed; callers that
 * already scanned can pass the list in to avoid a second workspace glob.
 */
export async function refreshLegacyMigrationContext(
  legacyEnvs?: LegacyEnv[]
): Promise<void> {
  const envs = legacyEnvs ?? (await findEnvsWithLegacyStorage());
  vscode.commands.executeCommand(
    "setContext",
    "vectorcastTestExplorer.vcastLegacyMigrationAvailable",
    envs.map((env) => envNodeId(env.enviroPath))
  );
}

/**
 * Keep the context key in sync with the filesystem:
 *  - legacy files appearing/disappearing (migration renames them);
 *  - UNITDATA.VCD appearing/disappearing — a build makes an env eligible (and a
 *    clean makes it ineligible), and that happens in-place without a focus
 *    change, so we must watch it directly;
 *  - VS Code regaining focus, as a catch-all for out-of-band changes.
 * Mirrors the requirements-availability watchers.
 */
export function setupLegacyMigrationWatchers(
  context: vscode.ExtensionContext
): void {
  const refresh = () => void refreshLegacyMigrationContext();

  const legacyWatcher = vscode.workspace.createFileSystemWatcher(
    "**/reqs-*/reqs.{xlsx,csv}"
  );
  legacyWatcher.onDidCreate(refresh, null, context.subscriptions);
  legacyWatcher.onDidDelete(refresh, null, context.subscriptions);
  context.subscriptions.push(legacyWatcher);

  const buildWatcher = vscode.workspace.createFileSystemWatcher(
    `**/${vcastEnviroFile}`
  );
  // A build can make an env newly pending; refresh the gating, then auto-offer
  // migration for it (once per session). A clean only needs a refresh. Scan
  // once and feed both so the build event doesn't glob the workspace twice.
  buildWatcher.onDidCreate(
    async () => {
      const legacyEnvs = await findEnvsWithLegacyStorage();
      await refreshLegacyMigrationContext(legacyEnvs);
      await maybeAutoOfferMigration(context, legacyEnvs);
    },
    null,
    context.subscriptions
  );
  buildWatcher.onDidDelete(refresh, null, context.subscriptions);
  context.subscriptions.push(buildWatcher);

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) refresh();
    })
  );

  refresh();
}

/**
 * Rename every legacy reqs file (reqs.xlsx and reqs.csv) for this env to
 * `reqs_migrated.<ext>` so they're kept as a backup but no longer match the
 * migration scan. We rename *both* — not just the one we imported — so an env
 * carrying both files doesn't get re-detected on the next pass.
 */
function renameLegacySources(enviroPath: string): void {
  const reqsDir = legacyReqsDir(enviroPath);
  for (const name of ["reqs.xlsx", "reqs.csv"]) {
    const source = path.join(reqsDir, name);
    if (!fs.existsSync(source)) continue;

    const ext = path.extname(name);
    const target = path.join(reqsDir, `reqs_migrated${ext}`);
    try {
      if (fs.existsSync(target)) fs.rmSync(target);
      fs.renameSync(source, target);
    } catch (err) {
      logCliOperation(
        `Could not rename ${source} to reqs_migrated${ext}: ${err}`
      );
    }
  }
}

/**
 * Migrate one env. With no existing RGW we just import the legacy file. When an
 * RGW already exists we let the user choose whether to overwrite it from the
 * legacy file or keep it as the source of truth. Either way — unless the user
 * cancels or the import fails — the legacy file is renamed so we don't prompt
 * again.
 */
async function migrateOne(env: LegacyEnv): Promise<MigrationOutcome> {
  const enviroName = path.basename(env.enviroPath);

  // With an existing RGW the user decides what wins; "Keep" skips the import
  // (the gateway stays the source of truth) but still renames the legacy file.
  if (findRelevantRequirementGateway(env.enviroPath)) {
    const OVERWRITE = "Overwrite from file";
    const KEEP = "Keep existing gateway";
    const choice = await vscode.window.showWarningMessage(
      `${enviroName} already has a Requirements Gateway (RGW).`,
      {
        modal: true,
        detail:
          `"Overwrite from file" rebuilds the RGW's requirements from ` +
          `${path.basename(env.legacySource)}, discarding what's currently in ` +
          `the RGW. "Keep existing gateway" leaves the RGW unchanged and just ` +
          `treats it as the source of truth. Either way the legacy file is ` +
          `renamed to reqs_migrated.* so you won't be prompted again.`,
      },
      OVERWRITE,
      KEEP
    );
    if (choice !== OVERWRITE && choice !== KEEP) return "cancelled";
    if (choice === KEEP) {
      renameLegacySources(env.enviroPath);
      return "migrated";
    }
  }

  const ok = await importRequirementsFromPath(
    env.enviroPath,
    env.legacySource,
    {
      progressTitle: `Migrating requirements for ${enviroName}`,
    }
  );
  if (!ok) return "failed";

  renameLegacySources(env.enviroPath);
  return "migrated";
}

/**
 * Prompt for and run migration over `legacyEnvs`. `explicit` (the command
 * palette) offers Migrate/Cancel; the automatic path adds "Not now" and a
 * "Don't show again" that sets the per-workspace skip.
 */
async function promptAndMigrate(
  context: vscode.ExtensionContext,
  legacyEnvs: LegacyEnv[],
  explicit: boolean
): Promise<void> {
  const envWord = legacyEnvs.length === 1 ? "environment" : "environments";
  const message =
    `VectorCAST now stores requirements in a Requirements Gateway (RGW) inside ` +
    `each environment rather than in reqs.xlsx / reqs.csv files. Found ` +
    `${legacyEnvs.length} ${envWord} with legacy requirements files. Migrating ` +
    `imports them into the RGW and renames the originals to reqs_migrated.* ` +
    `(kept as a backup). Migrate now?`;

  const buttons = explicit
    ? ["Migrate", "Cancel"]
    : ["Migrate", "Not now", "Don't show again"];
  const choice = await vscode.window.showInformationMessage(
    message,
    ...buttons
  );

  if (choice === "Don't show again") {
    await context.workspaceState.update(SKIP_KEY, true);
    return;
  }
  if (choice !== "Migrate") return;

  let migrated = 0;
  let failed = 0;
  for (const env of legacyEnvs) {
    const outcome = await migrateOne(env);
    if (outcome === "migrated") migrated++;
    else if (outcome === "failed") failed++;
    // "cancelled" → left as-is; it'll be offered again later.
  }

  await refreshLegacyMigrationContext();

  if (migrated === 0 && failed === 0) return;

  if (failed === 0) {
    vscode.window.showInformationMessage(
      `Migrated ${migrated} ${envWord} into the Requirements Gateway. The ` +
        `legacy reqs.xlsx / reqs.csv files were renamed to reqs_migrated.* as ` +
        `a backup. Right-click an environment and choose "Show Requirements" ` +
        `to view them.`
    );
  } else {
    vscode.window.showWarningMessage(
      `Migrated ${migrated}; ${failed} failed. See the ` +
        `"VectorCAST Requirement Test Generation Operations" output channel for details.`
    );
  }
}

/**
 * Command-palette flow: offer migration for every legacy env in the workspace —
 * including ones that already have a working RGW, so leftover files can be
 * cleaned up. Reports when there's nothing to do.
 */
async function offerLegacyMigration(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!reqs2xUsable) {
    vscode.window.showWarningMessage(
      "Reqs2X is not enabled, cannot migrate legacy requirements."
    );
    return;
  }

  const legacyEnvs = await findEnvsWithLegacyStorage();
  if (legacyEnvs.length === 0) {
    vscode.window.showInformationMessage(
      "No built environments with legacy requirements files (reqs.xlsx / reqs.csv) to migrate."
    );
    return;
  }
  await promptAndMigrate(context, legacyEnvs, true);
}

// Env node IDs already auto-prompted this session, so a rebuild or a second
// build event doesn't re-nag for the same env.
const autoOfferedEnvIds = new Set<string>();

/**
 * Automatically offer migration for envs with a legacy reqs file (whose
 * requirements actions are blocked until they migrate). Fires at activation and
 * whenever a build reveals such an env, but at most once per env per session
 * and never once "Don't show again" is set.
 */
async function maybeAutoOfferMigration(
  context: vscode.ExtensionContext,
  legacyEnvs?: LegacyEnv[]
): Promise<void> {
  if (context.workspaceState.get<boolean>(SKIP_KEY)) return;
  if (!reqs2xUsable) return;

  const envs = legacyEnvs ?? (await findEnvsWithLegacyStorage());
  const fresh = envs.filter(
    (env) => !autoOfferedEnvIds.has(envNodeId(env.enviroPath))
  );
  if (fresh.length === 0) return;

  for (const env of fresh) {
    autoOfferedEnvIds.add(envNodeId(env.enviroPath));
  }
  await promptAndMigrate(context, fresh, false);
}

/**
 * Automatic migration entry point — called at activation and after a build (see
 * setupLegacyMigrationWatchers). Offers migration for envs with a legacy file,
 * once per env per session, respecting "Don't show again".
 */
export async function maybeOfferLegacyMigration(
  context: vscode.ExtensionContext
): Promise<void> {
  await maybeAutoOfferMigration(context);
}

/**
 * Command-palette entry point: offers migration for every legacy env, ignoring
 * the per-workspace "Don't show again" choice. The escape hatch for users who
 * dismissed the automatic prompt.
 */
export async function runLegacyMigrationCommand(
  context: vscode.ExtensionContext
): Promise<void> {
  await offerLegacyMigration(context);
}

/**
 * Migrate a single env, invoked from the env's right-click menu. Skips the
 * workspace-wide "found N / migrate now?" prompt and goes straight to the
 * per-env flow (which still asks how to resolve an existing RGW).
 */
export async function migrateLegacyRequirementsForEnv(
  enviroPath: string
): Promise<void> {
  if (!reqs2xUsable) {
    vscode.window.showWarningMessage(
      "Reqs2X is not enabled, cannot migrate legacy requirements."
    );
    return;
  }

  const env = legacyEnvFor(enviroPath);
  if (!env) {
    vscode.window.showInformationMessage(
      "No legacy requirements files (reqs.xlsx / reqs.csv) found for this environment."
    );
    return;
  }

  const outcome = await migrateOne(env);
  await refreshLegacyMigrationContext();

  const enviroName = path.basename(enviroPath);
  if (outcome === "migrated") {
    vscode.window.showInformationMessage(
      `Migrated ${enviroName} into the Requirements Gateway. The legacy file ` +
        `was renamed to reqs_migrated.* as a backup. Right-click the ` +
        `environment and choose "Show Requirements" to view them.`
    );
  } else if (outcome === "failed") {
    vscode.window.showWarningMessage(
      `Migration failed for ${enviroName}. See the "VectorCAST Requirement ` +
        `Test Generation Operations" output channel for details.`
    );
  }
}
