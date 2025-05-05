import * as fs from "fs";
import { getSpecGroups } from "./specs_config";

function dumpGhaMatrix() {
  const versionsJson = process.env.VCAST_VERSIONS;
  if (!versionsJson) {
    throw new Error("VCAST_VERSIONS environment variable is not set.");
  }

  const versions = JSON.parse(versionsJson);
  const result: { version: number; group: string }[] = [];

  versions.forEach((version) => {
    const year = Number(version.slice(0, 4));
    const is2024OrHigher = year >= 2024;
    const specs = getSpecGroups(is2024OrHigher);
    Object.keys(specs).forEach((group) => {
      result.push({ version, group });
    });
  });

  fs.writeFileSync("gha_matrix.json", JSON.stringify(result));
}

const groups = dumpGhaMatrix();
