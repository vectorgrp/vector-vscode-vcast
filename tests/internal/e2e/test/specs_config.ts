import * as fs from 'fs';

export function getSpecGroups(vcast24: boolean) {
    const specGroups = {
      "basic_user_interactions": {"specs":[
          "./**/**/vcast.build_env.test.ts",
          "./**/**/vcast.create_script_1.test.ts",
          "./**/**/vcast.create_script_2_and_run.test.ts",
          "./**/**/vcast.create_second_test_1.test.ts",
          "./**/**/vcast.create_second_test_2_and_run.test.ts",
          "./**/**/vcast.third_test.test.ts",
          "./**/**/vcast.rest.test.ts",
          "./**/**/vcast.rest_2.test.ts",
          "./**/**/vcast.rest_3.test.ts",
        ],"params": {}},
      "build_env_failure":{"specs":[
        "./**/**/vcast_build_env_failure.test.ts",
        "./**/**/vcast_build_env_after_failure.test.ts"
        ], "env": {"VECTORCAST_DIR": "", 
                  "VECTORCAST_ATG_DIR": "",
                  "PATH": "/home/denis/.nvm/versions/node/v18.18.0/bin:/home/denis/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin"
        }},
      "bugs": {"specs":[
          "./**/**/vcast_testgen_bugs.test.ts",
          "./**/**/vcast_testgen_bugs_2.test.ts",
        ],"params": {}},
      "flask_icon": {"specs":[
          "./**/**/vcast_testgen_flask_icon.test.ts",
        ],"params": {}},
      "func_basis": {"specs":[
          "./**/**/vcast_testgen_func_basis.test.ts",
          "./**/**/vcast_testdel_func_basis.test.ts",
        ],"params": {}},
      "unit_basis": {"specs":[
          "./**/**/vcast_testgen_unit_basis.test.ts",
          "./**/**/vcast_testdel_unit_basis.test.ts",
        ],"params": {}},
      "env_basis": {"specs":[
          "./**/**/vcast_testgen_env_basis.test.ts",
          "./**/**/vcast_testdel_env_basis.test.ts"
        ],"params": {}},
    };

    if (vcast24) {
      specGroups["func_atg"] = {"specs":[
        "./**/**/vcast_testgen_func_atg.test.ts",
        "./**/**/vcast_testdel_func_atg.test.ts",
      ], "params": {}}

      specGroups["unit_atg"] = {"specs":[
        "./**/**/vcast_testgen_unit_atg.test.ts",
        "./**/**/vcast_testdel_unit_atg.test.ts",
      ], "params": {}}

      specGroups["env_atg"] = {"specs":[
        "./**/**/vcast_testgen_env_atg.test.ts",
        "./**/**/vcast_testdel_env_atg.test.ts"
      ], "params": {}}

      specGroups["coded_tests"] = {"specs":[
        "./**/**/vcast_coded_tests.test.ts"
      ], "params": {}}
    }

    // Convert specs object to JSON string
    const jsonString = JSON.stringify(specGroups, null, 4);

    // Write JSON string to a file
    fs.writeFileSync('spec_groups.json', jsonString);

    return specGroups;
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
      .map(group => group.specs || group)
      .flat();
};

export function getSpecGroupParameters(group: string, vcast24: boolean = false){
  const specGroup = getSpecGroups(vcast24);
  
  return specGroup[group].params
}