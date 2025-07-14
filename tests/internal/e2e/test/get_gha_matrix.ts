import * as fs from "fs";
import { getSpecGroups } from "./specs_config";

function dumpGhaMatrix() {
  const versionsJson = process.env.VCAST_VERSIONS;
  if (!versionsJson) {
    throw new Error("VCAST_VERSIONS environment variable is not set.");
  }

  // Read an optional “priority” so we can run that test‐group first in CI
  const prioritizeGroupsEnv = process.env.PRIORITIZE_SPEC_GROUP || "";
  const prioritizedGroups = prioritizeGroupsEnv
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0); // Handle empty strings if env is empty or malformed

  const versions: string[] = JSON.parse(versionsJson);
  let result: { version: string; group: string }[] = [];

  // build the matrix with filter if PRIORITIZE_SPEC_GROUP is defined
  versions.forEach((version) => {
    const year = Number(version.slice(0, 4));
    const is2024OrHigher = year >= 2024;
    const specs = getSpecGroups(is2024OrHigher);

    Object.keys(specs).forEach((group) => {
      // If prioritizedGroups is set, only include groups that match
      if (prioritizedGroups.length === 0 || prioritizedGroups.includes(group)) {
        result.push({ version, group });
      }
    });
  });

  // if a group is prioritized, move those entries to the front
  if (prioritizedGroups.length > 0) {
    const head: { version: string; group: string }[] = [];
    const tail: { version: string; group: string }[] = [];

    result.forEach((entry) => {
      if (prioritizedGroups.includes(entry.group)) {
        head.push(entry);
      } else {
        tail.push(entry);
      }
    });

    result = [...head, ...tail];
  }

  // write out the sorted matrix
  fs.writeFileSync("gha_matrix.json", JSON.stringify(result));

  // emit for GitHub Actions
  console.log(`matrix=${JSON.stringify(result)}`);
}

dumpGhaMatrix();
