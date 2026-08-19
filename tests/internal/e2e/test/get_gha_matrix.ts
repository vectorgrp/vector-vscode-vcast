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

  // Determine the latest release in the matrix (compare by year, then sp
  // number). Ada is only validated on the latest release, so the "ada" group is
  // added for that version only.
  const versionRank = (v: string): number => {
    const match = /(\d{4})sp(\d+)/.exec(v);
    return match ? Number(match[1]) * 1000 + Number(match[2]) : 0;
  };
  const latestVersion = versions.reduce(
    (latest, v) => (versionRank(v) > versionRank(latest) ? v : latest),
    versions[0]
  );

  // build the matrix with filter if PRIORITIZE_SPEC_GROUP is defined
  versions.forEach((version) => {
    const year = Number(version.slice(0, 4));
    const is2024OrHigher = year >= 2024;
    const is2025OrHigher = year >= 2025;
    const specs = getSpecGroups(is2024OrHigher, is2025OrHigher);

    Object.keys(specs).forEach((group) => {
      // The Ada specs (free env + managed project) are only validated on the
      // latest release (the version the Ada integration targets), so skip them
      // for every other version. The groups are always defined in specs_config
      // so the runner can resolve them, but they are dispatched to the matrix
      // for the latest version only.
      if (
        (group === "ada" || group === "ada_project") &&
        version !== latestVersion
      ) {
        return;
      }
      // If prioritizedGroups is set, only include groups that contain one of the names in the list
      if (
        prioritizedGroups.length === 0 ||
        prioritizedGroups.some((pg) => group.includes(pg))
      ) {
        result.push({ version, group });
      }
    });
  });

  // if a group is prioritized, move those entries to the front
  if (prioritizedGroups.length > 0) {
    const head: { version: string; group: string }[] = [];
    const tail: { version: string; group: string }[] = [];

    result.forEach((entry) => {
      if (prioritizedGroups.some((pg) => entry.group.includes(pg))) {
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
