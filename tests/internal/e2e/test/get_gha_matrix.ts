import * as fs from "fs";
import { getSpecGroups } from "./specs_config";

function dumpGhaMatrix() {
  const versionsJson = process.env.VCAST_VERSIONS;
  if (!versionsJson) {
    throw new Error("VCAST_VERSIONS environment variable is not set.");
  }

  // Read an optional “priority” so we can run that test‐group first in CI
  const prioritizeGroup = process.env.PRIORITIZE_SPEC_GROUP || "";
  const versions: string[] = JSON.parse(versionsJson);
  let result: { version: string; group: string }[] = [];

  // build the full matrix
  versions.forEach((version) => {
    const year = Number(version.slice(0, 4));
    const is2024OrHigher = year >= 2024;
    const specs = getSpecGroups(is2024OrHigher);
    Object.keys(specs).forEach((group) => {
      result.push({ version, group });
    });
  });

  // if a group is prioritized, move those entries to the front
  if (prioritizeGroup) {
    const head: typeof result = [];
    const tail: typeof result = [];

    result.forEach((entry) => {
      if (entry.group === prioritizeGroup) {
        head.push(entry);
      } else {
        tail.push(entry);
      }
    });

    result = [...head, ...tail];
  }

  // write out the sorted matrix
  fs.writeFileSync("gha_matrix.json", JSON.stringify(result, null, 2));

  // emit for GitHub Actions
  console.log(`matrix=${JSON.stringify(result)}`);
}

dumpGhaMatrix();
