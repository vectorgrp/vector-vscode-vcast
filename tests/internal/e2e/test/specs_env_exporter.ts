import { getEnvVarsForGroup } from "./specs_config";

const groupName = process.env.RUN_GROUP_NAME;
const envVars = getEnvVarsForGroup(groupName);

if (envVars) {
  console.log(envVars);
} else {
  console.error("No environment variables found or group not found.");
  process.exit(1); // Exit with an error code if no variables found
}
