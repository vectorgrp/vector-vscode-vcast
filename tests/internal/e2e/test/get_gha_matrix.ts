import * as fs from "fs";
import { getSpecGroups } from "./specs_config";

function dumpGhaMatrix() {
  const versionsJson = process.env.VCAST_VERSIONS;
  if (!versionsJson) {
    throw new Error("VERSIONS_JSON environment variable is not set.");
  }

  const versions = JSON.parse(versionsJson);
  const result: { version: number; group: string }[] = [];

  versions.forEach((version) => {
    const vcast24 = version.startsWith("2024");
    const specs = getSpecGroups(vcast24);
    Object.keys(specs).forEach((group) => {
      result.push({ version, group });
    });
  });

  fs.writeFileSync("gha_matrix.json", JSON.stringify(result));
}

const groups = dumpGhaMatrix();
