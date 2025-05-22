# extract_coverage_subprocess.py

import sys
import json
from vector.apps.DataAPI.unit_test_api import UnitTestApi

def extract_statement_coverage_uapi(environment_path, function_info):
    statement_coverage_function_mapping = {}

    with UnitTestApi(environment_path) as uapi:

        for unit in uapi.Unit.all():
            if unit.name in {"USER_GLOBALS_VCAST", "uut_prototype_stubs"}:
                continue

            for function in unit.functions:
                if function.name not in function_info.keys():
                   continue

                function_name = function.name
                statement_coverage_function_mapping[function_name] = {}
                statement_coverage_function_mapping[function_name]["num_statements"] = function.metrics.statements
                statement_coverage_function_mapping[function_name]["statement_coverage"] = function.metrics.aggregate_covered_statements
                statement_coverage_function_mapping[function_name]["percentage_statement_coverage"] = function.metrics.aggregate_covered_statements_pct

                statement_coverage_function_mapping[function_name]["lines"] = []

                function_offset = function.inst_start_line - function_info[function.name]["start_line"]

                statement_coverage_function_mapping[function_name]["offset"] = function_offset
                statement_coverage_function_mapping[function_name]["source_start_line"] = function.start_line

                for statement in function.statements:
                    if statement.covered() == 1:
                        for i in range(statement.start_line, statement.end_line + 1):
                           statement_coverage_function_mapping[function_name]["lines"].append(i)



    return statement_coverage_function_mapping



def main():
    input_json = json.load(sys.stdin)
    env_path = input_json["environment_path"]
    function_header_info = input_json["function_header_info"]

    result = extract_statement_coverage_uapi(env_path, function_header_info)
    print(json.dumps(result))


if __name__ == "__main__":
    main()