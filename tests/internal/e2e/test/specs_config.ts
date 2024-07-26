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
        VECTORCAST_ATG_DIR: "",
      },
      params: {
        vcReleaseOnPath: false,
      },
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
  }

  return specGroups;
}

export function getSpecsWithEnv(useVcast24: boolean) {
  const specGroups = getSpecGroups(useVcast24);

  Object.keys(specGroups).forEach((group) => {
    const groupObj = specGroups[group];

    // In that case we don t want the release path
    if (groupObj.params?.vcReleaseOnPath === false) {
      const pathWithoutRelease = processPathEnv();
      if (pathWithoutRelease !== undefined) {
        groupObj.env.PATH = pathWithoutRelease;
      }
    }
  });

  return specGroups;
}

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

function processPathEnv(): string | undefined {
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
