export function getSpecGroups(vcast24: boolean) {
  const specGroups = {
    basic_user_interactions: [
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
    bugs: [
      "./**/**/vcast_testgen_bugs.test.ts",
      "./**/**/vcast_testgen_bugs_2.test.ts",
    ],
    flask_icon: ["./**/**/vcast_testgen_flask_icon.test.ts"],
    func_basis: [
      "./**/**/vcast_testgen_func_basis.test.ts",
      "./**/**/vcast_testdel_func_basis.test.ts",
    ],
    unit_basis: [
      "./**/**/vcast_testgen_unit_basis.test.ts",
      "./**/**/vcast_testdel_unit_basis.test.ts",
    ],
    env_basis: [
      "./**/**/vcast_testgen_env_basis.test.ts",
      "./**/**/vcast_testdel_env_basis.test.ts",
    ],
  };

  if (vcast24) {
    specGroups["func_atg"] = [
      "./**/**/vcast_testgen_func_atg.test.ts",
      "./**/**/vcast_testdel_func_atg.test.ts",
    ];

    specGroups["unit_atg"] = [
      "./**/**/vcast_testgen_unit_atg.test.ts",
      "./**/**/vcast_testdel_unit_atg.test.ts",
    ];

    specGroups["env_atg"] = [
      "./**/**/vcast_testgen_env_atg.test.ts",
      "./**/**/vcast_testdel_env_atg.test.ts",
    ];

    specGroups["coded_tests"] = ["./**/**/vcast_coded_tests.test.ts"];
  }

  return specGroups;
}

export function getSpecs(vcast24: boolean, group: string = null) {
  const specGroups = getSpecGroups(vcast24);

  if (group != null) {
    return specGroups[group] || [];
  }
  return Object.values(specGroups).flat();
}
