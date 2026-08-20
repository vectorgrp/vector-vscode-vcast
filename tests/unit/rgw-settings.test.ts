import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readCsvSourcePath } from "../../src/requirements/rgwSettings";

// The snake_case keys mirror the on-disk JSON written by VectorCAST,
// so we'll disable the strictCamelCase check here.
/* eslint-disable @typescript-eslint/naming-convention */

const legacySettings = (csvPath: string) => ({
  current_gateway: "csv",
  csv: {
    csv_path: csvPath,
    id_attribute: "ID",
    key_attribute: "Key",
  },
});

const newCsvSettings = (csvPath: string) => ({
  import_attribute_id: "ID",
  import_attribute_key: "Key",
  import_csv_path: csvPath,
});

describe("RGW settings layout", () => {
  let innerDirectory: string;

  const write = (name: string, contents: unknown) => {
    fs.writeFileSync(
      path.join(innerDirectory, name),
      JSON.stringify(contents, null, 4),
      "utf8"
    );
  };

  beforeEach(() => {
    innerDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rgw-settings-"));
  });

  afterEach(() => {
    fs.rmSync(innerDirectory, { recursive: true, force: true });
  });

  test("reads the split layout written by VectorCAST 2026sp1+", () => {
    write("gateway_settings.json", {
      current_gateway: "csv",
      requirements_exist: true,
    });
    write("csv_settings.json", newCsvSettings("/reqs/new.csv"));

    expect(readCsvSourcePath(innerDirectory)).toBe("/reqs/new.csv");
  });

  test("reads the single-file layout written before 2026sp1", () => {
    write("settings.json", legacySettings("/reqs/old.csv"));

    expect(readCsvSourcePath(innerDirectory)).toBe("/reqs/old.csv");
  });

  test("prefers the split layout when a migrated gateway has both", () => {
    // 2026sp1 migrates settings.json but leaves it behind, where it goes stale.
    write("settings.json", legacySettings("/reqs/stale.csv"));
    write("gateway_settings.json", { current_gateway: "csv" });
    write("csv_settings.json", newCsvSettings("/reqs/current.csv"));

    expect(readCsvSourcePath(innerDirectory)).toBe("/reqs/current.csv");
  });

  test("falls back to settings.json when only gateway_settings.json migrated", () => {
    // Real shape seen in the field: migration wrote gateway_settings.json but
    // no csv_settings.json, leaving settings.json the only record of the path.
    write("gateway_settings.json", { current_gateway: "csv" });
    write("settings.json", legacySettings("/reqs/only-here.csv"));

    expect(readCsvSourcePath(innerDirectory)).toBe("/reqs/only-here.csv");
  });

  test("returns null for a non-CSV gateway in either layout", () => {
    write("settings.json", { current_gateway: "polarion" });
    expect(readCsvSourcePath(innerDirectory)).toBeNull();

    write("gateway_settings.json", { current_gateway: "polarion" });
    expect(readCsvSourcePath(innerDirectory)).toBeNull();
  });

  test("returns null when the CSV path is missing or unusable", () => {
    expect(readCsvSourcePath(innerDirectory)).toBeNull();

    write("gateway_settings.json", { current_gateway: "csv" });
    expect(readCsvSourcePath(innerDirectory)).toBeNull();

    write("csv_settings.json", { import_csv_path: "" });
    expect(readCsvSourcePath(innerDirectory)).toBeNull();
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
