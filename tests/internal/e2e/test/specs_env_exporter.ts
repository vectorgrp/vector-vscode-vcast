import { getEnvVarsForGroup } from "./specs_config";

const groupName = process.env.RUN_GROUP_NAME;
const envVars = getEnvVarsForGroup(groupName);

if (envVars) {
  console.log(envVars);
} else {
  // Exit with an error code if no variables found
  process.exit(1);
}
