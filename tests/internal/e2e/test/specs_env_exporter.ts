import { getEnvVarsForGroup, getSpecGroupsNames } from "./specs_config";

const groupName = process.env.RUN_GROUP_NAME;
let envVars: string;

// Get the command line arguments, excluding the first two default ones
const args = process.argv.slice(2);

// Check if an argument was provided
if (args.length > 0) {
    const mode = args[0];
    if (mode === "env_vars") {
      envVars = getEnvVarsForGroup(process.env.USE_VCAST_24 === "True", groupName);
    
      if (envVars) {
        // logs the env var of a spec group so that the runner can catch them.
        console.log(envVars);
      } else {
        // Exit with an error code if no variables found
        process.exit(1);
      }
    } else {
      const allGroupNames = getSpecGroupsNames(process.env.USE_VCAST_24 === "True");
      const groupNamesOutput = allGroupNames.join(",");
      console.log(groupNamesOutput);
    }
} else {
    console.log('No arguments provided.');
}
