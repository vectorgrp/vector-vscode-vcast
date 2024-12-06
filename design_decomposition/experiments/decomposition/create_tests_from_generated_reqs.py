import json
import random
import argparse
from tqdm import tqdm
from dcheck.processing.code_extraction import extract_function_defs
from dcheck.misc.util import paths_to_files
import charset_normalizer

# Import TestGenerator and RequirementReference
from test_generation.generation import TestGenerator
from codebase.extraction import RequirementReference
# Import TestEnvironmentManager
from test_generation.environment import TestEnvironmentManager

def main():
    parser = argparse.ArgumentParser(description='Generate tests from requirements.')
    parser.add_argument('requirements', nargs='?', default='DrvI2c/generated_reqs.json',
                        help='Path to the requirements JSON file.')
    parser.add_argument('--limit', '-n', type=int, help='Number of requirements to sample.')
    parser.add_argument('--output_file', '-o', help='Output file path.')
    parser.add_argument('--source_dirs', nargs='+',
                        help='List of source directories to search for function definitions.')
    # Add argument for requirement references file
    parser.add_argument('--requirement_references', help='Path to a file containing requirement references.')
    # Add argument for environments path
    parser.add_argument('--envs_path', help='Path to environments directory.')
    args = parser.parse_args()

    # Load requirements from JSON file
    with open(args.requirements) as f:
        requirements = json.load(f)

    requirement_ids = list(requirements.keys())

    # Randomly sample n requirement IDs
    if args.limit:
        sampled_requirement_ids = random.sample(requirement_ids, args.limit)
    else:
        sampled_requirement_ids = requirement_ids

    # Extract function definitions from source files
    source_files = paths_to_files(args.source_dirs)
    func_defs = []
    for source_file in tqdm(source_files):
        try:
            source_code = str(charset_normalizer.from_path(source_file).best())
            func_defs += extract_function_defs(source_code)
        except Exception as e:
            print(f'Error processing {source_file}: {e}')

    # Create a mapping from function names to function definitions
    func_def_dict = {func_def.name: func_def for func_def in func_defs}

    # Load requirement references
    with open(args.requirement_references) as f:
        requirement_references_data = json.load(f)
        requirement_references = [RequirementReference(**ref) for ref in requirement_references_data]

    # Instantiate TestEnvironmentManager
    env_manager = TestEnvironmentManager(args.envs_path)

    # Instantiate TestGenerator with environment manager
    test_generator = TestGenerator(requirements, requirement_references, args.source_dirs, environment_manager=env_manager)

    # Generate tests and save to output file
    with open(args.output_file, 'w') as output_file:
        for requirement_id in sampled_requirement_ids:
            function_name = requirement_id.split('.')[0]
            requirement_text = requirements[requirement_id]

            # Generate test case for the requirement
            result = test_generator.generate_test_case(requirement_id, 0, False)

            # Get the function definition
            func_def = func_def_dict.get(function_name)

            if func_def:
                code_with_design = func_def.code_with_design
            else:
                code_with_design = f'Function {function_name} not found.'

            if result:
                # Write to the output file
                output_file.write(f'Requirement ID: {requirement_id}\n')
                output_file.write(f'Requirement Text: {requirement_text}\n')
                output_file.write(f'Function Name: {function_name}\n')
                output_file.write('Code with Design:\n')
                output_file.write(code_with_design + '\n')
                output_file.write('Generated Test Description:\n')
                output_file.write(result.test_description + '\n')
                output_file.write('Test Cases:\n')
                for test_case in result.test_cases:
                    vectorcast_case = test_case.to_vectorcast([requirement_id])
                    output_file.write(vectorcast_case + '\n')
                    # Execute the test case and capture the output
                    unit_names = set(test_case.unit_names)
                    environment = env_manager.get_environment(unit_names)
                    if environment:
                        output = environment.run_tests([vectorcast_case], execute=True)
                        # Write the output to the file
                        output_file.write('Execution Output:\n')
                        output_file.write(output + '\n')
                    else:
                        output_file.write('No suitable environment found for execution.\n')
                output_file.write('=' * 40 + '\n')
            else:
                output_file.write(f'Could not generate test for {requirement_id}\n')
                output_file.write('=' * 40 + '\n')

if __name__ == '__main__':
    main()
