const path = require("path");
const fs = require("fs");

// VectorCAST 2026sp1 split the RGW's settings.json
// ({current_gateway, csv: {csv_path}}) into gateway_settings.json plus
// csv_settings.json ({import_csv_path}). Migration leaves the now-stale
// settings.json behind, so a split file wins wherever it exists — but it can
// also write one split file and not the other, so each is read independently.

function readJson(filePath: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Source CSV path recorded in the settings under `innerDir` (the
 * `requirements_gateway/` directory). Null when the gateway isn't CSV-backed
 * (we don't yet know how to round-trip other source types) or the path is absent.
 */
export function readCsvSourcePath(innerDir: string): string | null {
  const gatewaySettings = readJson(
    path.join(innerDir, "gateway_settings.json")
  );
  const legacySettings = readJson(path.join(innerDir, "settings.json"));

  // gateway_settings.json, where present, is authoritative for which gateway is
  // active; before the split that lived in settings.json.
  const gateway = gatewaySettings
    ? gatewaySettings.current_gateway
    : legacySettings?.current_gateway;
  if (gateway !== "csv") return null;

  // Migration can write gateway_settings.json without csv_settings.json, which
  // leaves settings.json the only record of the path.
  const csvSettings = readJson(path.join(innerDir, "csv_settings.json"));
  return (
    nonEmptyString(csvSettings?.import_csv_path) ??
    nonEmptyString(legacySettings?.csv?.csv_path)
  );
}
