import json
import argparse
from test_generation import TestGenerator
from code_extraction import extract_all_requirement_references, RequirementReference

def main():
    parser = argparse.ArgumentParser(description='Generate and optionally execute test cases for a given requirement.')
    parser.add_argument('requirement_id', nargs='?', default='LLR.PLAT.REG.AVAIL.003', help='Requirement ID to generate tests for.')
    parser.add_argument('--source_dirs', nargs='+', default=['pi--innovo/src'], help='List of source directories.')
    parser.add_argument('--execute', action='store_true', help='Execute the generated test cases.')
    parser.add_argument('--envs_path', default='pi--innovo/vcast/Pi_Innovo/build', help='Path to environments directory.')
    parser.add_argument('--requirement_references_file', help='Path to a file containing requirement references.')
    parser.add_argument('--requirements_file', default='extracted_reqs.json', help='Path to a file containing requirements.')
    args = parser.parse_args()

    with open(args.requirements_file) as f:
        requirements = json.load(f)

    if args.requirement_references_file:
        with open(args.requirement_references_file) as f:
            requirement_references_data = json.load(f)
            requirement_references = [RequirementReference(**ref) for ref in requirement_references_data]
    else:
        requirement_references = extract_all_requirement_references(args.source_dirs[0])

    test_generator = TestGenerator(requirements, requirement_references, args.source_dirs)
    result, completion = test_generator.generate_test_case(args.requirement_id, 0, False, return_raw_completion=True)
    if result:
        print("Test Description:")
        print(result.test_description)
        print("Test quantity and quality analysis:")
        print(result.test_quantity_and_quality_analysis)
        print("Test Mapping Analysis:")
        print(result.test_mapping_analysis)
        vectorcast_test_cases = []
        for test_case in result.test_cases:
            print("VectorCAST Test Case:")
            vectorcast_case = test_case.to_vectorcast([args.requirement_id])
            print(vectorcast_case)
            vectorcast_test_cases.append(vectorcast_case)
        if args.execute:
            from test_environment import TestEnvironmentManager
            env_manager = TestEnvironmentManager(args.envs_path)
            unit_names = set(unit_name for test_case in result.test_cases for unit_name in test_case.unit_names)
            environment = env_manager.get_environment(unit_names)
            if environment:
                output = environment.run_tests(vectorcast_test_cases, execute=True)
                print("Execution Output:")
                print(output)
            else:
                print("No suitable environment found for execution.")

        # Calculate and save cost information
        input_tokens = completion.usage.prompt_tokens
        output_tokens = completion.usage.completion_tokens
        total_tokens = input_tokens + output_tokens

        input_cost = (input_tokens / 1000) * 0.00275
        output_cost = (output_tokens / 1000) * 0.011
        total_cost = input_cost + output_cost

        with open('cost.txt', 'w') as cost_file:
            cost_file.write(f"Input Tokens: {input_tokens}\n")
            cost_file.write(f"Output Tokens: {output_tokens}\n")
            cost_file.write(f"Total Tokens: {total_tokens}\n")
            cost_file.write(f"Input Cost: €{input_cost:.6f}\n")
            cost_file.write(f"Output Cost: €{output_cost:.6f}\n")
            cost_file.write(f"Total Cost: €{total_cost:.6f}\n")

if __name__ == '__main__':
    main()
