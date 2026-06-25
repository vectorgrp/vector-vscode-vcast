import * as os from "node:os";
import {
  expandEnvVars,
  findRelevantRequirementGateway,
  RGW_INNER_DIR,
} from "./rgwPath";
import { runReqs2xTool } from "./processRunner";
import { PANREQ_EXECUTABLE_PATH } from "./requirementsExecutables";

const path = require("path");
const fs = require("fs");

// ---------- Types -----------------------------------------------------------

export interface RGWRequirement {
  id: string;
  title: string;
  description: string;
  last_modified?: string;
  [key: string]: any;
}

// requirements.json: { "<source_bucket>": { "<req_id>": RGWRequirement } }
export type RGWRequirementsFile = Record<
  string,
  Record<string, RGWRequirement>
>;

export interface RGWTraceabilityEntry {
  unit: string | null;
  function: string | null;
  lines: number[] | null;
}

// traceability.json: { "<req_id>": RGWTraceabilityEntry }
export type RGWTraceabilityFile = Record<string, RGWTraceabilityEntry>;

export interface RGWOrigin {
  generated_by_reqs2x: boolean;
}

export interface RGWFileMtimes {
  requirements: number;
  traceability: number;
  origin: number;
}

export interface RGWBundle {
  gatewayPath: string;
  origin: RGWOrigin;
  requirements: RGWRequirementsFile;
  traceability: RGWTraceabilityFile;
  mtimes: RGWFileMtimes;
}

export class RGWStaleWriteError extends Error {
  constructor(public readonly file: "requirements" | "traceability") {
    super(
      `RGW ${file} file changed on disk since it was loaded; refusing to overwrite.`
    );
    this.name = "RGWStaleWriteError";
  }
}

/**
 * What the user is allowed to edit for a given bundle. Single source of
 * truth for the rule "external-source RGWs lock requirement bodies": webview
 * disables matching inputs, extension redacts matching fields out of the
 * incoming patch on save.
 */
export interface RequirementsEditPolicy {
  /** title and description editable iff true. */
  bodiesEditable: boolean;
}

export function editPolicyFor(bundle: RGWBundle): RequirementsEditPolicy {
  return { bodiesEditable: bundle.origin.generated_by_reqs2x };
}

/**
 * Apply the policy to a webview-sourced patch. Substitutes the loaded copy of
 * any field that's locked, so a tampered webview can't sneak edits through.
 */
export function applyEditPolicy(
  bundle: RGWBundle,
  incoming: {
    requirements: RGWRequirementsFile;
    traceability: RGWTraceabilityFile;
  }
): { requirements: RGWRequirementsFile; traceability: RGWTraceabilityFile } {
  return editPolicyFor(bundle).bodiesEditable
    ? incoming
    : {
        requirements: bundle.requirements,
        traceability: incoming.traceability,
      };
}

// ---------- Path / file helpers --------------------------------------------

function rgwFilePaths(gatewayPath: string) {
  const inner = path.join(gatewayPath, RGW_INNER_DIR);
  return {
    inner,
    requirements: path.join(inner, "requirements.json"),
    traceability: path.join(inner, "traceability.json"),
    origin: path.join(inner, "origin.json"),
    settings: path.join(inner, "settings.json"),
  };
}

function mtimeMsOrZero(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function writeAtomic(target: string, contents: string): void {
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, contents, "utf-8");
  fs.renameSync(tmp, target);
}

/**
 * Read the source CSV path out of `settings.json`. Returns null when the
 * gateway isn't CSV-backed (we don't yet know how to round-trip other
 * source types) or when the field is missing.
 */
function readCsvSourcePath(gatewayPath: string): string | null {
  const settingsPath = rgwFilePaths(gatewayPath).settings;
  if (!fs.existsSync(settingsPath)) return null;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    if (settings.current_gateway !== "csv") return null;
    const csvPath = settings.csv?.csv_path;
    return typeof csvPath === "string" && csvPath.length > 0 ? csvPath : null;
  } catch {
    return null;
  }
}

/**
 * True iff the configured gateway both exists *and* contains a
 * `requirements.json` we can actually read. This is the predicate menu
 * enablement and "is there anything to export" should consult — distinct
 * from `findRelevantRequirementGateway` which only resolves the path.
 *
 * Without this distinction, deleting just `requirements.json` (leaving the
 * gateway directory intact) leaves the UI claiming requirements are
 * available while every reader downstream returns null.
 */
export function hasCompleteAndUsableRGW(enviroPath: string): boolean {
  const rawGatewayPath = findRelevantRequirementGateway(enviroPath);
  if (!rawGatewayPath) return false;

  const gatewayPath = expandEnvVars(rawGatewayPath);
  if (!fs.existsSync(gatewayPath)) return false;

  return fs.existsSync(rgwFilePaths(gatewayPath).requirements);
}

/**
 * True if `csvPath` looks like a Python-tempfile-generated CSV — the kind of
 * transient working CSV older Reqs2X CLIs recorded in `settings.json` when
 * generating an RGW. Genuine external imports point at persistent files, so a
 * temp-looking source means the RGW was almost certainly generated by us. We
 * don't check whether the file still exists: a save rewrites the CSV at that
 * path, and the RGW should stay editable either way.
 *
 * Heuristic: parent directory is the OS temp dir (`os.tmpdir()` matches
 * Python's `tempfile.gettempdir()` on every platform we ship to) and the
 * basename matches `tempfile.NamedTemporaryFile`'s default `tmp<random>`
 * prefix with a `.csv` suffix.
 */
function looksLikeTempCsv(csvPath: string): boolean {
  const tmpdir = os.tmpdir();
  const isWindows = process.platform === "win32";
  const inTempDir = isWindows
    ? csvPath.toLowerCase().startsWith(tmpdir.toLowerCase())
    : csvPath.startsWith(tmpdir);
  if (!inTempDir) return false;

  // Python's `tempfile._RandomNameSequence` yields 8 chars from
  // [A-Za-z0-9_]; we're lenient with the length to cover Python-version
  // drift and any custom prefixes that still start with "tmp".
  return /^tmp[A-Za-z0-9_]{6,}\.csv$/i.test(path.basename(csvPath));
}

// ---------- Read ------------------------------------------------------------

/**
 * Read the RGW bundle from `<rgw>/requirements_gateway/`. Missing
 * traceability/origin files are tolerated (treated as empty / external-source).
 * Returns null when no gateway is configured, the gateway directory is absent,
 * or there are no requirements yet to display.
 */
export function readRGWBundle(enviroPath: string): RGWBundle | null {
  const rawGatewayPath = findRelevantRequirementGateway(enviroPath);
  if (!rawGatewayPath) return null;

  const gatewayPath = expandEnvVars(rawGatewayPath);
  if (!fs.existsSync(gatewayPath)) return null;

  const files = rgwFilePaths(gatewayPath);
  if (!fs.existsSync(files.requirements)) return null;

  const requirements: RGWRequirementsFile = JSON.parse(
    fs.readFileSync(files.requirements, "utf-8")
  );

  const traceability: RGWTraceabilityFile = fs.existsSync(files.traceability)
    ? JSON.parse(fs.readFileSync(files.traceability, "utf-8"))
    : {};

  let origin: RGWOrigin = { generated_by_reqs2x: false };
  if (fs.existsSync(files.origin)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(files.origin, "utf-8"));
      origin = { generated_by_reqs2x: parsed.generated_by_reqs2x === true };
    } catch {
      // malformed origin.json → treat as external/read-only
    }
  } else {
    // Backwards-compat for RGWs produced by older Reqs2X CLIs that didn't
    // write origin.json: a temp-looking source CSV means the RGW was almost
    // certainly generated by us (genuine external imports point at persistent
    // files).
    const csvPath = readCsvSourcePath(gatewayPath);
    if (csvPath && looksLikeTempCsv(csvPath)) {
      origin = { generated_by_reqs2x: true };
    }
  }

  return {
    gatewayPath,
    origin,
    requirements,
    traceability,
    mtimes: {
      requirements: mtimeMsOrZero(files.requirements),
      traceability: mtimeMsOrZero(files.traceability),
      origin: mtimeMsOrZero(files.origin),
    },
  };
}

// ---------- Write -----------------------------------------------------------

/**
 * Persist edits back into the RGW.
 *
 * Requirement bodies travel via the source CSV (kept in sync as the durable
 * external artifact): we serialize the updates to a temp JSON in panreq's
 * input shape and run panreq to overwrite the CSV. We then mirror the same
 * data into `requirements.json` ourselves — `clicast RGw Import` only adds
 * *new* requirements (it deliberately doesn't overwrite existing bodies, and
 * there's no `Reimport` subcommand).
 *
 * Traceability is written directly. Done last so a panreq failure leaves
 * on-disk state consistent (no fresh trace pointing at stale requirements).
 *
 * Throws RGWStaleWriteError if either file's mtime has advanced since the
 * bundle was loaded.
 */
export async function writeRGWBundle(
  enviroPath: string,
  gatewayPath: string,
  updates: {
    requirements: RGWRequirementsFile;
    traceability: RGWTraceabilityFile;
  },
  expected: Pick<RGWFileMtimes, "requirements" | "traceability">
): Promise<RGWFileMtimes> {
  const files = rgwFilePaths(gatewayPath);

  const currentReqMtime = mtimeMsOrZero(files.requirements);
  if (currentReqMtime !== expected.requirements) {
    throw new RGWStaleWriteError("requirements");
  }
  const currentTraceMtime = mtimeMsOrZero(files.traceability);
  if (currentTraceMtime !== expected.traceability) {
    throw new RGWStaleWriteError("traceability");
  }

  const csvPath = readCsvSourcePath(gatewayPath);
  if (!csvPath) {
    throw new Error(
      "Cannot save: this RGW's source is not a CSV (or settings.json is missing). Only CSV-backed RGWs are editable."
    );
  }

  // 1. Hand panreq the requirements as a temp JSON; have it write the CSV.
  //    panreq's JSON *input* shape is a flat list, each entry carrying `key`,
  //    `id`, `title`, `description` (plus any extras). This is asymmetric with
  //    panreq's JSON *output* shape (nested `{bucket: {id: req}}`), so we
  //    flatten + project here. The inner-mapping key is panreq's `key`,
  //    distinct from `id` in general.
  const flatList: Array<Record<string, any>> = [];
  for (const bucket of Object.values(updates.requirements)) {
    for (const [reqKey, req] of Object.entries(bucket)) {
      const trace = updates.traceability[reqKey];
      flatList.push({
        ...req,
        key: reqKey,
        id: req.id ?? reqKey,
        title: req.title ?? "",
        description: req.description ?? "",
        unit: trace?.unit ?? null,
        function: trace?.function ?? null,
      });
    }
  }

  const tmpJson = path.join(
    os.tmpdir(),
    `vcast-reqs-${process.pid}-${Date.now()}.json`
  );
  fs.writeFileSync(tmpJson, JSON.stringify(flatList, null, 2), "utf-8");

  try {
    await runReqs2xTool({
      exe: PANREQ_EXECUTABLE_PATH,
      args: [
        tmpJson,
        csvPath,
        "--target-format",
        "csv",
        "--target-env",
        `${enviroPath}.env`,
      ],
    });
  } finally {
    try {
      fs.unlinkSync(tmpJson);
    } catch {
      // best-effort cleanup
    }
  }

  // 2. Mirror the same data into requirements.json. Bucket key is normalized
  //    to the current csv_path so consumers see a consistent source path.
  const consolidated: Record<string, RGWRequirement> = {};
  for (const bucket of Object.values(updates.requirements)) {
    for (const [reqKey, req] of Object.entries(bucket)) {
      consolidated[reqKey] = req;
    }
  }
  writeAtomic(
    files.requirements,
    JSON.stringify({ [`[CSV] [${csvPath}]`]: consolidated }, null, 4)
  );

  // 3. Write traceability.json directly. RGW's invariant is one-to-one with
  //    requirements: every requirement key has an entry, even if it's all
  //    null. Without this normalization a partial save would leave a sparse
  //    traceability.json (or a stale one with entries for removed
  //    requirements), which downstream tools mis-handle.
  const normalizedTraceability: RGWTraceabilityFile = {};
  for (const reqKey of Object.keys(consolidated)) {
    normalizedTraceability[reqKey] = updates.traceability[reqKey] ?? {
      unit: null,
      function: null,
      lines: null,
    };
  }
  writeAtomic(
    files.traceability,
    JSON.stringify(normalizedTraceability, null, 4)
  );

  return {
    requirements: mtimeMsOrZero(files.requirements),
    traceability: mtimeMsOrZero(files.traceability),
    origin: mtimeMsOrZero(files.origin),
  };
}

// ---------- Infer traceability ---------------------------------------------

/**
 * Run panreq with `--infer-traceability` against the RGW's source CSV. The
 * tool uses an LLM to populate unit/function for each requirement and writes
 * the result back into the RGW. Wrapped in a cancellable progress
 * notification (same UX as code2reqs/reqs2tests).
 *
 * With `onlyUntraced`, panreq leaves already-traced requirements untouched and
 * only infers the incomplete ones. The caller must confirm panreq supports the
 * flag first (see `panreqSupportsOnlyUntraced`).
 *
 * Returns the freshly-read bundle on success, null if the user cancelled.
 */
export async function inferTraceability(
  enviroPath: string,
  gatewayPath: string,
  options: { onlyUntraced?: boolean } = {}
): Promise<RGWBundle | null> {
  const csvPath = readCsvSourcePath(gatewayPath);
  if (!csvPath) {
    throw new Error(
      "Cannot infer traceability: this RGW's source is not a CSV (or settings.json is missing)."
    );
  }

  const enviroName = path.basename(enviroPath);
  const args = [
    csvPath,
    gatewayPath,
    "--target-format",
    "rgw",
    "--infer-traceability",
    "--target-env",
    `${enviroPath}.env`,
    "--json-events",
  ];
  if (options.onlyUntraced) args.push("--only-untraced");

  const result = await runReqs2xTool({
    exe: PANREQ_EXECUTABLE_PATH,
    args,
    llm: true,
    progress: {
      title: options.onlyUntraced
        ? `Inferring Traceability (untraced only) for ${enviroName}`
        : `Inferring Traceability (all requirements) for ${enviroName}`,
      logPrefix: "panreq",
    },
  });

  if (result.cancelled) return null;
  return readRGWBundle(enviroPath);
}
