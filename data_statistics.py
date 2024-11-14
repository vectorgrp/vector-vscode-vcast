import json
import os
from test_extraction import extract_all_test_cases
from code_extraction import extract_all_functions, extract_all_requirement_references

with open('extracted_reqs.json') as f:
    requirements = json.load(f)

test_cases = extract_all_test_cases('.')
functions = extract_all_functions('.')
requirement_references = extract_all_requirement_references('.')

# Calculate statistics
num_test_cases = len(test_cases)
num_functions = len(functions)
num_requirement_references = len(requirement_references)
num_requirements = len(requirements)

# Number of test cases where a requirement is mentioned that is not in the json
unmatched_test_cases = len([tc for tc in test_cases if any(req not in requirements for req in tc.requirement_keys)])

# Identify relevant requirement IDs
referenced_requirements = {r.id for r in requirement_references} & set(requirements.keys())

training_test_cases = [tc for tc in test_cases if all(req in referenced_requirements for req in tc.requirement_keys) and tc.requirement_keys]
len(training_test_cases)
training_test_cases[0].requirement_keys


# Track tested and untested requirements
tested_requirements = [requirement_id for requirement_id in requirements if any(requirement_id in tc.requirement_keys for tc in test_cases)]
untested_requirements = [requirement_id for requirement_id in requirements if requirement_id not in tested_requirements]

# Do the same but for requirements that are also referenced in code
referenced_tested_requirements = [requirement_id for requirement_id in referenced_requirements if any(requirement_id in tc.requirement_keys for tc in test_cases)]
referenced_untested_requirements = [requirement_id for requirement_id in referenced_requirements if requirement_id not in referenced_tested_requirements]

referenced_untested_requirements[0]

def search_files_for_requirements(requirements, directory='.'):
    found_in_files = {req: [] for req in requirements}
    for root, _, files in os.walk(directory):
        for file in files:
            file_path = os.path.join(root, file)
            if 'low_level' not in file_path:
                continue
            with open(file_path, 'r', errors='ignore') as f:
                content = f.read()
                for req in requirements:
                    if req in content:
                        found_in_files[req].append(file_path)
    return found_in_files

# Track unknown requirements
unknown_requirements = {requirement_id for t in test_cases for requirement_id in t.requirement_keys if requirement_id not in requirements}

# Search for unknown requirements in files
unknown_requirements_files = search_files_for_requirements(unknown_requirements)

# Print statistics
print(f"Total number of test cases: {num_test_cases}")
print(f"Total number of functions: {num_functions}")
print(f"Total number of requirement references: {num_requirement_references}")
print(f"Total number of known requirements: {num_requirements}")
print(f"Number of test cases with unknown requirements: {unmatched_test_cases}")
print(f"Number of known, referenced requirements: {len(referenced_requirements)}")
print(f"Number of known, tested requirements: {len(tested_requirements)}")
print(f"Number of known, untested requirements: {len(untested_requirements)}")
print(f"Number of known, referenced, tested requirements: {len(referenced_tested_requirements)}")
print(f"Number of known, referenced, untested requirements: {len(referenced_untested_requirements)}")
print(f"Number of unknown, tested requirements: {len(unknown_requirements)}")

print("\nUnknown Requirements Found in Files:")
for requirement_id, files in unknown_requirements_files.items():
    if files:
        print(f"  - {requirement_id} found in:")
        for file in files:
            print(f"    - {file}")
    else:
        print(f"  - {requirement_id} not found in any file")

num_not_found = sum(1 for files in unknown_requirements_files.values() if not files)
print(f"\nNumber of unknown requirements not found in any file: {num_not_found}")

