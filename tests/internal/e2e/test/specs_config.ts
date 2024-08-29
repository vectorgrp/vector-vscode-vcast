/**
 * Returns all spec groups.
 * @param useVcast24 Boolean whether release 24 is used or not.
 * @returns Returns all spec groups.
 */
export function getSpecGroups(useVcast24: boolean) {
  const specGroups = {
    basic_user_interactions: {
      specs: [
        "./**/**/vcast.build_env.test.ts",
        "./**/**/vcast.create_script_1.test.ts",
        "./**/**/vcast.create_script_2_and_run.test.ts",
        "./**/**/vcast.create_second_test_1.test.ts",
        "./**/**/vcast.create_second_test_2_and_run.test.ts",
        "./**/**/vcast.third_test.test.ts",
        "./**/**/vcast.rest.test.ts",
        "./**/**/vcast.rest_2.test.ts",
        "./**/**/vcast.rest_3.test.ts",
      ],
      env: {},
      params: {},
    },
    build_env_failure: {
      specs: [
        "./**/**/vcast_build_env_failure.test.ts",
        "./**/**/vcast_build_env_after_failure.test.ts",
      ],
      env: {
        VECTORCAST_DIR_TEST_DUPLICATE: process.env.VECTORCAST_DIR,
        VECTORCAST_DIR: "",
      },
      params: {
        vcReleaseOnPath: false,
      },
    },
    build_different_envs: {
      specs: ["./**/**/vcast_build_env_failure_different_paths.test.ts"],
      env: {
        VECTORCAST_DIR: `/vcast/release23:${process.env.HOME}/vcast/release23`,
        BUILD_MULTIPLE_ENVS: "True",
      },
      params: {},
    },
    bugs: {
      specs: [
        "./**/**/vcast_testgen_bugs.test.ts",
        "./**/**/vcast_testgen_bugs_2.test.ts",
      ],
      env: {},
      params: {},
    },
    flask_icon: {
      specs: ["./**/**/vcast_testgen_flask_icon.test.ts"],
      env: {},
      params: {},
    },
    func_basis: {
      specs: [
        "./**/**/vcast_testgen_func_basis.test.ts",
        "./**/**/vcast_testdel_func_basis.test.ts",
      ],
      env: {},
      params: {},
    },
    unit_basis: {
      specs: [
        "./**/**/vcast_testgen_unit_basis.test.ts",
        "./**/**/vcast_testdel_unit_basis.test.ts",
      ],
      env: {},
      params: {},
    },
    env_basis: {
      specs: [
        "./**/**/vcast_testgen_env_basis.test.ts",
        "./**/**/vcast_testdel_env_basis.test.ts",
      ],
      env: {},
      params: {},
    },
  };

  if (useVcast24) {
    specGroups["func_atg"] = {
      specs: [
        "./**/**/vcast_testgen_func_atg.test.ts",
        "./**/**/vcast_testdel_func_atg.test.ts",
      ],
      env: {},
      params: {},
    };

    specGroups["unit_atg"] = {
      specs: [
        "./**/**/vcast_testgen_unit_atg.test.ts",
        "./**/**/vcast_testdel_unit_atg.test.ts",
      ],
      env: {},
      params: {},
    };

    specGroups["env_atg"] = {
      specs: [
        "./**/**/vcast_testgen_env_atg.test.ts",
        "./**/**/vcast_testdel_env_atg.test.ts",
      ],
      env: {},
      params: {},
    };

    specGroups["coded_tests"] = {
      specs: ["./**/**/vcast_coded_tests.test.ts"],
      env: {},
      params: {},
    };

    specGroups["coded_mock"] = {
      specs: ["./**/**/vcast_coded_test_completion.test.ts"],
      env: {},
      params: {},
    };

    specGroups["coded_mock_different_env"] = {
      specs: ["./**/**/vcast_coded_test_different_envs_hover.test.ts"],
      env: {
        VECTORCAST_DIR: `/vcast/release24_sp1:${process.env.HOME}/vcast/release24_sp1`,
        SWITCH_ENV_AT_THE_END: "True",
      },
      params: {},
    };
  }

  return specGroups;
}

/**
 * Returns the spec groups including their env variables and handles group params.
 * @param useVcast24 Boolean whether release 24 is used or not.
 * @returns Spec groups with env variables.
 */
export function getSpecsWithEnv(useVcast24: boolean) {
  const specGroups = getSpecGroups(useVcast24);

  Object.keys(specGroups).forEach((group) => {
    const groupObj = specGroups[group];

    // In that case we don t want the release to be on PATH
    if (groupObj.params?.vcReleaseOnPath === false) {
      const pathWithoutRelease = removeReleaseOnPath();
      if (pathWithoutRelease !== undefined) {
        groupObj.env.PATH = pathWithoutRelease;
      }
    }
  });

  return specGroups;
}

/**
 * Returns the env variables for spec a group.
 * @param useVcast24 Boolean whether release 24 is used or not.
 * @param groupName Name of a spec group.
 * @returns Env var for a spec group.
 */
export function getEnvVarsForGroup(
  useVcast24: boolean,
  groupName: string
): string {
  // Fetch spec groups with environment variables
  const specGroups = getSpecsWithEnv(useVcast24);

  // Check if the specified group exists
  if (!specGroups[groupName] || !specGroups[groupName].env) {
    console.error(
      `Group "${groupName}" not found or has no environment variables.`
    );
    return "";
  }

  // Extract environment variables
  const envVars = specGroups[groupName].env;

  // Convert environment variables to KEY=VALUE format
  return Object.entries(envVars)
    .map(([key, value]) => `${key}=${value || ""}`)
    .join("\n");
}

/**
 * Get all specs or from a group (if contained in the params).
 * @param vcast24 Boolean whether release 24 is used or not.
 * @param group Name of a spec group.
 * @returns
 */
export function getSpecs(vcast24: boolean, group: string = null) {
  const specGroups = getSpecGroups(vcast24);

  if (group != null) {
    // Check if the group exists and has a 'specs' key; otherwise, return an empty array
    if (specGroups[group]) {
      return specGroups[group].specs || specGroups[group];
    } else {
      return [];
    }
  }

  // Flatten the specs arrays for all groups
  return Object.values(specGroups)
    .map((group) => group.specs || group)
    .flat();
}

/**
 * Splits all paths from the PATH env variable that contain a "release".
 * @returns New PATH env var without "release" paths
 */
export function removeReleaseOnPath(): string | undefined {
  // Get the PATH environment variable
  const envPath = process.env.PATH;

  if (!envPath) {
    console.error("PATH environment variable is not defined.");
    return undefined;
  }

  // Split the PATH on ":"
  const paths = envPath.split(":");

  // Filter out paths that contain "release"
  const filteredPaths = paths.filter((path) => !path.includes("release"));

  // Join the remaining paths back together with ":"
  const newPath = filteredPaths.join(":");

  return newPath;
}
