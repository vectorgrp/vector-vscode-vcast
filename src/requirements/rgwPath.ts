import * as vscode from "vscode";

const path = require("path");
const fs = require("fs");

export const DEFAULT_RGW_SUBDIR = "rgw";

// The RGW directory contains a `requirements_gateway/` subdirectory which
// holds the JSON files we read and write. code2reqs/panreq own this layout.
export const RGW_INNER_DIR = "requirements_gateway";

/**
 * Expand $(VAR) tokens in the configured VCAST_REPOSITORY path against
 * process.env. Unknown variables are left as-is and a one-time warning is
 * surfaced to the user — better to leave the literal in place than silently
 * resolve to "".
 */
export function expandEnvVars(inputPath: string): string {
  return inputPath.replace(/\$\(([^)]+)\)/g, (match, varName) => {
    const value = process.env[varName];

    if (!value) {
      vscode.window.showWarningMessage(
        `Environment variable "${varName}" in VCAST_REPOSITORY is not defined.`
      );
      return match;
    }

    return value;
  });
}

/**
 * Read VCAST_REPOSITORY out of the CCAST_.CFG adjacent to `enviroPath`.
 * Returns the *raw* (unexpanded) configured form so callers that want to
 * write the value back to CCAST_.CFG can preserve the user's $(VAR) syntax.
 * Returns null if the config is missing, the line isn't set, or the resolved
 * directory doesn't exist.
 */
export function findRelevantRequirementGateway(
  enviroPath: string
): string | null {
  const parentDir = path.dirname(enviroPath);
  const configPath = path.join(parentDir, "CCAST_.CFG");

  if (!fs.existsSync(configPath)) return null;

  const configContent = fs.readFileSync(configPath, "utf-8");
  const gatewayMatch = configContent.match(/VCAST_REPOSITORY:\s*(.+)\s*/);
  if (gatewayMatch == null) return null;

  const rawGatewayPath = gatewayMatch[1].trim();
  const gatewayPath = expandEnvVars(rawGatewayPath);

  if (!fs.existsSync(gatewayPath)) return null;
  return rawGatewayPath;
}

/**
 * Default on-disk location for a freshly created RGW. Used when the user
 * runs Generate Requirements on an environment that has no VCAST_REPOSITORY
 * configured yet.
 */
export function defaultRequirementGatewayPath(enviroPath: string): string {
  const parentDir = path.dirname(enviroPath);
  const enviroName = path.basename(enviroPath).replace(/\.env$/, "");
  return path.join(parentDir, `reqs-${enviroName}`, DEFAULT_RGW_SUBDIR);
}

/**
 * Set VCAST_REPOSITORY in the CCAST_.CFG adjacent to `enviroPath`. Replaces
 * any existing line, otherwise appends a new one.
 */
export function setVcastRepositoryInConfig(
  enviroPath: string,
  gatewayPath: string
): void {
  const parentDir = path.dirname(enviroPath);
  const configPath = path.join(parentDir, "CCAST_.CFG");
  const line = `VCAST_REPOSITORY: ${gatewayPath}`;

  let content = "";
  if (fs.existsSync(configPath)) {
    content = fs.readFileSync(configPath, "utf-8");
  }

  if (/^VCAST_REPOSITORY:.*$/m.test(content)) {
    content = content.replace(/^VCAST_REPOSITORY:.*$/m, line);
  } else {
    if (content.length > 0 && !content.endsWith("\n")) content += "\n";
    content += `${line}\n`;
  }

  fs.writeFileSync(configPath, content, "utf-8");
}

/** Remove the VCAST_REPOSITORY line from CCAST_.CFG if present. */
export function clearVcastRepositoryInConfig(enviroPath: string): void {
  const parentDir = path.dirname(enviroPath);
  const configPath = path.join(parentDir, "CCAST_.CFG");
  if (!fs.existsSync(configPath)) return;

  const content = fs.readFileSync(configPath, "utf-8");
  const stripped = content.replace(/^VCAST_REPOSITORY:.*\r?\n?/m, "");
  if (stripped !== content) {
    fs.writeFileSync(configPath, stripped, "utf-8");
  }
}
