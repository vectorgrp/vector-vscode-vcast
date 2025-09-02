from functools import lru_cache
import os
import subprocess
import json

from autoreq.codebase import Codebase
from pathlib import Path
import re
import argparse
import csv
from pydantic import BaseModel
from typing import List


class RequirementCoverageInfo(BaseModel):
    function: str
    requirement_id: str
    required_lines: List[int]
    covered_lines: List[int]
    fully_covered: bool


class RequirementCoverage:
    def __init__(self, environment, requirements):
        self.environment = environment
        self.requirements = requirements

    @lru_cache(maxsize=None)
    def _get_function_header_info(self, tu_file):
        """Extracts the neccessary function header information from the tu file"""
        cb = Codebase(
            [os.path.join(self.environment.env_dir, self.environment.env_name)]
        )
        function_lines = {}

        all_functions = cb.get_functions_in_file(tu_file)

        for function in all_functions:
            function_lines[function["name"]] = {}
            function_lines[function["name"]]["start_line"] = function["start_line"] + 1
            function_lines[function["name"]]["end_line"] = function["end_line"] + 1

        return function_lines

    def _source_to_cleaned_tu(
        self,
        source_lines,
        tu_file_path,
        tu_function_start_line,
        tu_function_end_line,
        source_function_start_line,
    ):
        """Maps the lines of code from the given source file to the lines of code from the cleaned tu file"""
        with open(tu_file_path) as f:
            trans_content = f.readlines()

        raw_mapping = {}

        # this creates more dictionary keys than necessary, but its a good estimator, that always over estimates
        for i, _ in enumerate(range(tu_function_start_line, tu_function_end_line + 1)):
            raw_mapping[i + source_function_start_line] = []

        source_idx = source_function_start_line
        i = tu_function_start_line - 1
        for tu_line in trans_content[tu_function_start_line - 1 :]:
            if i >= tu_function_end_line - 1:
                break

            m = re.match(r"#\s(\d+)\s(\".*\")(\s\d)*", tu_line.strip())
            if m:
                source_idx = int(m.group(1))
                i += 1
                continue

            raw_mapping[source_idx].append(i + 1)
            source_idx += 1
            i += 1

        cleaned_trans_content, orig = self.environment.get_tu_content(
            return_mapping=True
        )

        line_mapping = {}
        for i, _ in enumerate(cleaned_trans_content.splitlines()):
            line_mapping[orig[i]] = i + 1

        mapped_func_header_line = line_mapping[tu_function_start_line]

        final_mapping = {}
        for line in source_lines:
            final_mapping[line] = [
                line_mapping[rline] - mapped_func_header_line
                for rline in raw_mapping[line]
            ]
            # final_mapping[line] = [line_mapping[rline] for rline in raw_mapping[line]]

        return final_mapping

    def _requirement_coverage_info(self, coverage_dict, requirement_id):
        # Find the requirement by key
        requirement = next(
            (req for req in self.requirements if req.key == requirement_id), None
        )
        if requirement is None:
            return None

        func = requirement.location.function
        required_lines = requirement.location.lines

        if required_lines is None:
            return None

        covered_lines = set(coverage_dict[func].get("lines", []))
        is_covered = any(
            [required_line in covered_lines for required_line in required_lines]
        )

        return RequirementCoverageInfo(
            function=func,
            requirement_id=requirement_id,
            required_lines=sorted(list(required_lines)),
            covered_lines=sorted(list(covered_lines)),
            fully_covered=is_covered,
        )

    def _get_tu_file_paths(self):
        tu_file_paths = []
        for unit_name in self.environment.units:
            tu_path_c = os.path.join(
                self.environment.env_dir, self.environment.env_name, f"{unit_name}.tu.c"
            )
            tu_path_cpp = os.path.join(
                self.environment.env_dir,
                self.environment.env_name,
                f"{unit_name}.tu.cpp",
            )

            if os.path.exists(tu_path_c):
                tu_path = tu_path_c
            elif os.path.exists(tu_path_cpp):
                tu_path = tu_path_cpp
            else:
                raise FileNotFoundError(
                    f"Translation unit file not found for {unit_name}"
                )

            tu_file_paths.append(tu_path)

        return tu_file_paths

    def _extract_covered_vcast_lines(self, function_header_info):
        # Prepare input for subprocess
        input_data = {
            "environment_path": os.path.join(
                self.environment.env_dir, self.environment.env_name
            ),
            "function_header_info": function_header_info,
        }

        # Call subprocess
        proc = subprocess.Popen(
            ["vpython", Path(__file__).with_name("extract_coverage_subprocess.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        stdout, stderr = proc.communicate(json.dumps(input_data))
        if proc.returncode != 0:
            raise RuntimeError(stderr)

        # Result: list of lists
        result = json.loads(stdout)
        return result

    def check_requirement_coverage(self, requirement_id, test_cases):
        tu_file_paths = self._get_tu_file_paths()
        function_header_info = self._get_function_header_info(tu_file_paths[0])

        result = None

        def callback():
            nonlocal result
            result = self._extract_covered_vcast_lines(function_header_info)

            return result

        self.environment.run_tests(test_cases, post_run_callback=callback)

        covered_lines = {}
        for function in function_header_info:
            if function not in result:
                continue

            covered_tu_mapping = self._source_to_cleaned_tu(
                result[function]["lines"],
                tu_file_paths[0],
                function_header_info[function]["start_line"],
                function_header_info[function]["end_line"],
                result[function]["source_start_line"] - result[function]["offset"],
            )
            covered_lines[function] = {}
            covered_lines[function]["lines"] = [
                line for orig_line in covered_tu_mapping.values() for line in orig_line
            ]

        coverage_info = self._requirement_coverage_info(covered_lines, requirement_id)
        return coverage_info


def export_json(dic: RequirementCoverageInfo, output_json_path):
    try:
        with open(output_json_path, "w") as json_file:
            json.dump(dic.model_dump(), json_file, indent=4)
        print(f"Data successfully exported to {output_json_path}")
    except Exception as e:
        print(f"Failed to export data: {e}")


def export_csv(dic: List[RequirementCoverageInfo], output_csv_path):
    """
    Converts a list of RequirementCoverageInfo objects into a CSV file.

    Args:
        results (list of RequirementCoverageInfo): The list of Pydantic models containing results.
        output_csv_path (str): The file path where the CSV should be written.

    Returns:
        None
    """
    # Define the CSV headers based on the keys in the `results` dictionary
    headers = [
        "requirement",
        "function",
        "required_lines",
        "covered_lines",
        "fully_covered",
    ]

    try:
        # Open the output file in write mode
        with open(output_csv_path, mode="w", newline="") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=headers)

            # Write the header row
            writer.writeheader()

            # Write each result dictionary as a row in the CSV
            for result_model in dic:
                # Convert Pydantic model to a dictionary for CSV writing
                result_dict = result_model.model_dump()
                # Convert `required_lines` and `covered_lines` to strings for CSV output
                result_dict["required_lines"] = ", ".join(
                    map(str, result_dict["required_lines"])
                )
                result_dict["covered_lines"] = ", ".join(
                    map(str, result_dict["covered_lines"])
                )

                # Create a row dictionary that matches the headers
                row_to_write = {
                    "requirement_id": result_model.requirement_id,
                    "function": result_model.function,
                    "required_lines": ", ".join(map(str, result_model.required_lines)),
                    "covered_lines": ", ".join(map(str, result_model.covered_lines)),
                    "fully_covered": result_model.fully_covered,
                }
                writer.writerow(row_to_write)

        print(f"Data successfully exported to {output_csv_path}")
    except Exception as e:
        print(f"Error writing CSV: {e}")


def cli():
    # TODO: Fix the cli
    from sys import exit

    exit(1)
    parser = argparse.ArgumentParser(
        prog="check-requirement-coverage",
        description="Match executed lines inside a VectorCAST environment against "
        "a requirements.json file.",
    )
    parser.add_argument(
        "environment_path", help="Directory containing the VectorCAST environment"
    )
    parser.add_argument(
        "requirement_file_path",
        help="Path to requirements.json describing needed coverage",
    )
    parser.add_argument(
        "--export-json",
        help="Write JSON report to a file instead of stdout",
    )
    parser.add_argument(
        "--export-csv",
        help="Write CSV report to a file instead of stdout",
    )
    parser.add_argument(
        "--silent",
        action="store_true",
        help="Silent output, without any extractions. Usually for debugging",
    )

    args = parser.parse_args()

    rc = RequirementCoverage(args.environment_path, args.requirement_file_path)
    coverage_agreement = rc.check_requirement_coverage()

    if args.silent:
        return

    if args.export_json:
        export_json(coverage_agreement, args.export_json)
        return

    if args.export_csv:
        export_csv(coverage_agreement, args.export_csv)
        return

    print(coverage_agreement.json(indent=4))
