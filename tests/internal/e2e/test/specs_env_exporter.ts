import { getEnvVarsForGroup } from "./specs_config";

const groupName = process.env.RUN_GROUP_NAME;
let envVars: string;

if (process.env.USE_VCAST_24 === "True") {
  envVars = getEnvVarsForGroup(true, groupName);
} else {
  envVars = getEnvVarsForGroup(false, groupName);
}

if (envVars) {
  console.log(envVars);
} else {
  // Exit with an error code if no variables found
  process.exit(1);
}
