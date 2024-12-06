import json
import argparse
import asyncio
from tqdm.asyncio import tqdm_asyncio
from test_generation.generation import TestGenerator
from codebase.extraction import extract_all_requirement_references, RequirementReference
# 'LLR.PLAT.REG.AVAIL.003'

async def main():
    parser = argparse.ArgumentParser(description='Generate and optionally execute test cases for given requirements.')
    parser.add_argument('requirement_ids', nargs='*', default=[], help='Requirement IDs to generate tests for.')
    parser.add_argument('--source_dirs', nargs='+', default=['data/pi--innovo/src'], help='List of source directories.')
    parser.add_argument('--execute', action='store_true', help='Execute the generated test cases.')
    parser.add_argument('--envs_path', default='data/pi--innovo/vcast/Pi_Innovo/build', help='Path to environments directory.')
    parser.add_argument('--requirement_references_file', help='Path to a file containing requirement references.')
    parser.add_argument('--requirements_file', default='data/pi--innovo/extracted_reqs.json', help='Path to a file containing requirements.')
    parser.add_argument('--output_file', help='Path to a file to write the VectorCAST test cases.')
    parser.add_argument('--retries', type=int, default=3, help='Number of retries for test generation.')
    args = parser.parse_args()

    with open(args.requirements_file) as f:
        requirements = json.load(f)

    if args.requirement_references_file:
        with open(args.requirement_references_file) as f:
            requirement_references_data = json.load(f)
            requirement_references = [RequirementReference(**ref) for ref in requirement_references_data]
    else:
        requirement_references = extract_all_requirement_references(args.source_dirs[0])

    from test_generation.environment import TestEnvironmentManager

    env_manager = TestEnvironmentManager(args.envs_path)

    test_generator = TestGenerator(
        requirements, requirement_references, environment_manager=env_manager)

    failed_requirements = []

    vectorcast_test_cases = []

    async def generate_and_process_test_case(requirement_id):
        result, completion = await test_generator.generate_test_case(
            requirement_id, return_raw_completion=True, max_retries=args.retries)
        if result:
            print(f"Test Description for {requirement_id}:")
            print(result.test_description)
            print("Test Mapping Analysis:")
            print(result.test_mapping_analysis)
            for test_case in result.test_cases:
                print("VectorCAST Test Case:")
                vectorcast_case = test_case.to_vectorcast([requirement_id])
                print(vectorcast_case)
                vectorcast_test_cases.append(vectorcast_case)

            if args.execute:
                unit_names = set(unit_name for test_case in result.test_cases for unit_name in test_case.unit_names)
                environment = env_manager.get_environment(unit_names)
                if environment:
                    output = environment.run_tests(vectorcast_test_cases, execute=True)
                    print("Execution Output:")
                    print(output)
                else:
                    print("No suitable environment found for execution.")
        else:
            failed_requirements.append(requirement_id)
        return completion

    requirements_to_check = args.requirement_ids or requirements.keys()
    completions = await tqdm_asyncio.gather(
        *[generate_and_process_test_case(requirement_id) for requirement_id in requirements_to_check]
    )

    if args.output_file:
        with open(args.output_file, 'w') as output_file:
            for vectorcast_case in vectorcast_test_cases:
                output_file.write(vectorcast_case + '\n')

    print("Failed requirements:")
    print(failed_requirements)

    # Calculate and save cost information
    input_tokens = sum(completion.usage.prompt_tokens for completion in completions if completion)
    output_tokens = sum(completion.usage.completion_tokens for completion in completions if completion)
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
    asyncio.run(main())
