export function getSpecGroups(vcast24: boolean) {
    const specGroups = {
      0: [
          "./**/**/vcast.build_env.test.ts",
          "./**/**/vcast.create_script_1.test.ts",
          "./**/**/vcast.create_script_2_and_run.test.ts",
          "./**/**/vcast.create_second_test_1.test.ts",
          "./**/**/vcast.create_second_test_2_and_run.test.ts",
          "./**/**/vcast.third_test.test.ts",
          "./**/**/vcast.rest.test.ts",
          "./**/**/vcast.rest_2.test.ts",
          "./**/**/vcast.rest_3.test.ts",
        ].concat(vcast24 ? ["./**/**/vcast_coded_tests.test.ts"] : []),
      1: [
          "./**/**/vcast_testgen_bugs.test.ts",
          "./**/**/vcast_testgen_bugs_2.test.ts",
        ],
      2: [
          "./**/**/vcast_testgen_flask_icon.test.ts",
        ],
      3: [
          "./**/**/vcast_testgen_func_basis.test.ts",
          "./**/**/vcast_testdel_func_basis.test.ts",
        ],
      4: [
          "./**/**/vcast_testgen_unit_basis.test.ts",
          "./**/**/vcast_testdel_unit_basis.test.ts",
        ],
      5: [
          "./**/**/vcast_testgen_env_basis.test.ts",
          "./**/**/vcast_testdel_env_basis.test.ts"
        ],
      6: [
          "./**/**/vcast_testgen_func_atg.test.ts",
          "./**/**/vcast_testdel_func_atg.test.ts",
        ],
    };

    if (vcast24) {
      specGroups[7] = [
        "./**/**/vcast_testgen_func_atg.test.ts",
        "./**/**/vcast_testdel_func_atg.test.ts",
      ];

      specGroups[8] = [
        "./**/**/vcast_testgen_unit_atg.test.ts",
        "./**/**/vcast_testdel_unit_atg.test.ts",
      ];

      specGroups[9] = [
        "./**/**/vcast_testgen_env_atg.test.ts",
        "./**/**/vcast_testdel_env_atg.test.ts"
      ];
    }

    return specGroups;
}


export function getSpecs(vcast24: boolean, group: number = null) {
    const specGroups = getSpecGroups(vcast24);

    if (group != null) {
        return specGroups[group] || [];
    }
    return Object.values(specGroups).flat();
};
