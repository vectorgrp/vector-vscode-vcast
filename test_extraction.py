import os
import re
import json
from typing import List
from pydantic import BaseModel, Field


class TestCase(BaseModel):
    environment: str
    unit: str
    subprogram: str
    test_name: str
    test_code: str

    @property
    def requirement_keys(self) -> List[str]:
        return re.findall(r'TEST\.REQUIREMENT_KEY:(.*)', self.test_code)

    @property
    def test_code_no_requirements(self) -> str:
        return re.sub(r'^.*TEST\.REQUIREMENT_KEY:.*\n', '', self.test_code, flags=re.MULTILINE).strip()


def parse_tst_file(filename: str) -> List[TestCase]:
    with open(filename, 'r') as f:
        lines = f.readlines()

    environment = ''
    test_cases = []
    current_unit = ''
    current_subprogram = ''
    current_test_code = ''
    current_test_name = ''
    in_test = False

    # Extract environment from the header
    for line in lines:
        env_match = re.match(r'-- Environment\s+:\s+(.*)', line)
        if env_match:
            environment = env_match.group(1).strip()
            break

    for line in lines:
        line = line.strip()
        if line.startswith('TEST.UNIT:'):
            current_unit = line.split(':', 1)[1].strip()
        elif line.startswith('TEST.SUBPROGRAM:'):
            current_subprogram = line.split(':', 1)[1].strip()
        elif line.startswith('TEST.NEW'):
            in_test = True
            current_test_code = line + '\n'
        elif in_test:
            current_test_code += line + '\n'
            if line.startswith('TEST.NAME:'):
                current_test_name = line.split(':', 1)[1].strip()
            if line.startswith('TEST.END'):
                # Create TestCase object
                test_case = TestCase(
                    environment=environment,
                    unit=current_unit,
                    subprogram=current_subprogram,
                    test_name=current_test_name,
                    test_code=current_test_code.strip()
                )
                test_cases.append(test_case)
                # Reset for the next test case
                current_test_code = ''
                current_test_name = ''
                in_test = False
    return test_cases


def extract_all_test_cases(directory: str) -> List[TestCase]:
    test_cases = []
    for root, _, files in os.walk(directory):
        for file in files:
            if file.endswith('.tst'):
                filepath = os.path.join(root, file)
                test_cases.extend(parse_tst_file(filepath))
    return test_cases


def main():
    directory = '.'  # Set your target directory here
    test_cases = extract_all_test_cases(directory)
    json_data = [test_case.model_dump() for test_case in test_cases]
    with open('test_cases.json', 'w') as json_file:
        json.dump(json_data, json_file, indent=4)


if __name__ == '__main__':
    main()