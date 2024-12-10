import json
import csv
import argparse
import asyncio
import logging
import os  # Add this import
from tqdm.asyncio import tqdm_asyncio
from test_generation.generation import TestGenerator
from test_generation.environment import Environment  # Import Environment instead of TestEnvironmentManager

async def main():
    parser = argparse.ArgumentParser(description='Generate and optionally execute test cases for given requirements.')
    parser.add_argument('env_path', help='Path to the VectorCAST environment file.')
    parser.add_argument('requirements_csv', help='Path to the CSV file containing requirements.')
    parser.add_argument('requirement_ids', nargs='*', help='ID of the requirement to generate test cases for.')
    parser.add_argument('--execute', action='store_true', help='Execute the generated test cases.')
    parser.add_argument('--export-tst', help='Path to a file to write the VectorCAST test cases.')
    parser.add_argument('--retries', type=int, default=3, help='Number of retries for test generation.')
    parser.add_argument('--extended_reasoning', action='store_true', help='Use extended reasoning for test generation.')
    args = parser.parse_args()

    log_level = os.environ.get('LOG_LEVEL', 'WARNING').upper()
    numeric_level = getattr(logging, log_level, logging.INFO)
    logging.basicConfig(level=numeric_level)

    # Initialize the environment directly
    environment = Environment(args.env_path)

    # Load requirements from CSV file
    with open(args.requirements_csv, newline='') as csvfile:
        reader = csv.DictReader(csvfile)
        requirements = {}
        for row in reader:
            req_id = row['ID']
            requirements[req_id] = row['Description']

    test_generator = TestGenerator(
        requirements, environment=environment, use_extended_reasoning=args.extended_reasoning)  # Pass environment directly

    vectorcast_test_cases = []

    async def generate_and_process_test_case(requirement_id):
        result = await test_generator.generate_test_case(requirement_id, max_retries=args.retries)
        if result:
            logging.info(f"Test Description for {requirement_id}:\n{result.test_description}")
            logging.info("Test Mapping Analysis:\n%s", result.test_mapping_analysis)
            for test_case in result.test_cases:
                logging.info("VectorCAST Test Case:\n%s", test_case.to_vectorcast([requirement_id]))
                vectorcast_test_cases.append(test_case.to_vectorcast([requirement_id]))

            if args.execute:
                output = environment.run_tests(vectorcast_test_cases, execute=True)
                logging.info("Execution Output:\n%s", output)

    requirements_to_check = requirements if len(args.requirement_ids) == 0 else args.requirement_ids

    # Generate tests for all requirements
    await tqdm_asyncio.gather(
        *[generate_and_process_test_case(requirement_id) for requirement_id in requirements_to_check]
    )

    if args.export_tst:
        with open(args.export_tst, 'w') as output_file:
            for vectorcast_case in vectorcast_test_cases:
                output_file.write(vectorcast_case + '\n')

    # Analyze info_logger data
    info_data = test_generator.info_logger.data

    # Derive failed requirements
    failed_requirements = [req_id for req_id, data in info_data.items()
                           if not data['test_generated']]

    if failed_requirements:
        logging.warning("Failed to generate tests for the following requirements:")
        logging.warning(", ".join(failed_requirements))

    # Warn about requirements with test run failure feedback
    test_failure_requirements = [req_id for req_id, data in info_data.items()
                                 if data['test_run_failure_feedback'] and data['test_generated']]

    if test_failure_requirements:
        logging.warning("Failing tests were given as feedback for the following requirements:")
        logging.warning(", ".join(test_failure_requirements))

    # Get token usage and total cost from LLMClient
    token_usage = test_generator.llm_client.get_token_usage()
    total_cost_info = test_generator.llm_client.total_cost

    # Display token usage and costs
    logging.info("Token Usage and Costs:")
    logging.info(f"Generation Model - Input Tokens: {token_usage['generation']['input_tokens']}")
    logging.info(f"Generation Model - Output Tokens: {token_usage['generation']['output_tokens']}")
    logging.info(f"Reasoning Model - Input Tokens: {token_usage['reasoning']['input_tokens']}")
    logging.info(f"Reasoning Model - Output Tokens: {token_usage['reasoning']['output_tokens']}")
    logging.info(f"Total Tokens: {token_usage['generation']['input_tokens'] + token_usage['generation']['output_tokens'] + token_usage['reasoning']['input_tokens'] + token_usage['reasoning']['output_tokens']}")

    logging.info(f"Generation Model - Input Cost: ${total_cost_info['generation']['input_cost']:.6f}")
    logging.info(f"Generation Model - Output Cost: ${total_cost_info['generation']['output_cost']:.6f}")
    logging.info(f"Reasoning Model - Input Cost: ${total_cost_info['reasoning']['input_cost']:.6f}")
    logging.info(f"Reasoning Model - Output Cost: ${total_cost_info['reasoning']['output_cost']:.6f}")
    logging.info(f"Total Cost: ${total_cost_info['total_cost']:.6f}")

    # Save info logger data to a JSON file
    with open('info_logger.json', 'w') as info_file:
        json.dump(info_data, info_file, indent=4)

if __name__ == '__main__':
    asyncio.run(main())
