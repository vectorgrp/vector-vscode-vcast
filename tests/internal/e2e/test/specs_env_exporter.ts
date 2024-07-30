import { getEnvVarsForGroup } from "./specs_config";

// logs the env var of a spec group so that the runner can catch them.

const groupName = process.env.RUN_GROUP_NAME;
let envVars: string;

envVars =
  process.env.USE_VCAST_24 === "True"
    ? getEnvVarsForGroup(true, groupName)
    : getEnvVarsForGroup(false, groupName);

if (envVars) {
  console.log(envVars);
} else {
  // Exit with an error code if no variables found
  process.exit(1);
}
