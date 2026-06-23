import { getEnvVarsForGroup } from "./specs_config";

// logs the env var of a spec group so that the runner can catch them.

const groupName = process.env.RUN_GROUP_NAME;
let envVars: string;

const useVcast24 = process.env.USE_VCAST_24 === "True";
const useVcast25 = process.env.USE_VCAST_25 === "True";

envVars = getEnvVarsForGroup(useVcast24, groupName, useVcast25);

if (envVars) {
  console.log(envVars);
} else {
  // Exit with an error code if no variables found
  process.exit(1);
}
