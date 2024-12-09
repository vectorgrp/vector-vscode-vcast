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
    parser.add_argument('--extended_reasoning', action='store_true', help='Use extended reasoning for test generation.')  # Add this line
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
        requirements, requirement_references, environment_manager=env_manager, use_extended_reasoning=args.extended_reasoning)  # Modify this line

    vectorcast_test_cases = []

    async def generate_and_process_test_case(requirement_id):
        result = await test_generator.generate_test_case(requirement_id, max_retries=args.retries)
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

    requirements_to_check = args.requirement_ids or requirements.keys()
    await tqdm_asyncio.gather(
        *[generate_and_process_test_case(requirement_id) for requirement_id in requirements_to_check]
    )

    if args.output_file:
        with open(args.output_file, 'w') as output_file:
            for vectorcast_case in vectorcast_test_cases:
                output_file.write(vectorcast_case + '\n')

    # Analyze info_logger data
    info_data = test_generator.info_logger.data

    # Derive failed requirements
    failed_requirements = [req_id for req_id, data in info_data.items()
                           if not data['test_generated']]

    if failed_requirements:
        print("Warning: Failed to generate tests for the following requirements:")
        for req_id in failed_requirements:
            print(f"- {req_id}")

    # Warn about requirements with test run failure feedback
    test_failure_requirements = [req_id for req_id, data in info_data.items()
                                 if data['test_run_failure_feedback']]

    if test_failure_requirements:
        print("Warning: Failing tests were generated and their output used as feedback for the following requirements:")
        for req_id in test_failure_requirements:
            print(f"- {req_id}")

    # Get token usage and total cost from LLMClient
    token_usage = test_generator.llm_client.get_token_usage()
    total_cost_info = test_generator.llm_client.total_cost

    # Display token usage and costs
    print("Token Usage and Costs:")
    print(f"Generation Model - Input Tokens: {token_usage['generation']['input_tokens']}")
    print(f"Generation Model - Output Tokens: {token_usage['generation']['output_tokens']}")
    print(f"Reasoning Model - Input Tokens: {token_usage['reasoning']['input_tokens']}")
    print(f"Reasoning Model - Output Tokens: {token_usage['reasoning']['output_tokens']}")
    print(f"Total Tokens: {token_usage['generation']['input_tokens'] + token_usage['generation']['output_tokens'] + token_usage['reasoning']['input_tokens'] + token_usage['reasoning']['output_tokens']}")

    print(f"Generation Model - Input Cost: ${total_cost_info['generation']['input_cost']:.6f}")
    print(f"Generation Model - Output Cost: ${total_cost_info['generation']['output_cost']:.6f}")
    print(f"Reasoning Model - Input Cost: ${total_cost_info['reasoning']['input_cost']:.6f}")
    print(f"Reasoning Model - Output Cost: ${total_cost_info['reasoning']['output_cost']:.6f}")
    print(f"Total Cost: ${total_cost_info['total_cost']:.6f}")

    # Save info logger data to a JSON file
    with open('info_logger.json', 'w') as info_file:
        json.dump(info_data, info_file, indent=4)

if __name__ == '__main__':
    asyncio.run(main())
