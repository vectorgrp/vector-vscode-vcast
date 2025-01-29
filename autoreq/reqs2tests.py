import json
import csv
import argparse
import asyncio
import logging
import os
import tempfile  # Add this import if not already present
from tqdm import tqdm
from .test_generation.generation import TestGenerator
from .test_generation.environment import Environment  # Ensure Environment is imported

def group_requirements_by_function(requirements_dict, batch_size=8):
    """Group requirements by their function name and split into batches if too large."""
    # First group by function
    grouped = {}
    for req_id in requirements_dict:
        function_name = req_id.rsplit('.', 1)[0]
        if function_name not in grouped:
            grouped[function_name] = []
        grouped[function_name].append(req_id)
    
    # Then split large groups into smaller batches
    batched = {}
    for function_name, req_ids in grouped.items():
        if len(req_ids) <= batch_size:
            batched[function_name] = req_ids
        else:
            # Split into smaller batches
            for i in range(0, len(req_ids), batch_size):
                batch = req_ids[i:i + batch_size]
                batch_key = f"{function_name}_batch_{i//batch_size}"
                batched[batch_key] = batch
    
    return batched

async def main():
    parser = argparse.ArgumentParser(description='Generate and optionally execute test cases for given requirements.')
    parser.add_argument('env_path', help='Path to the VectorCAST environment file.')
    parser.add_argument('requirements_csv', help='Path to the CSV file containing requirements.')
    parser.add_argument('requirement_ids', nargs='*', help='ID of the requirement to generate test cases for.')
    parser.add_argument('--export-tst', help='Path to a file to write the VectorCAST test cases.')
    parser.add_argument('--retries', type=int, default=2, help='Number of retries for test generation.')
    parser.add_argument('--extended-reasoning', action='store_true', help='Use extended reasoning for test generation.')
    parser.add_argument('--export-env', action='store_true', help='Run the generated test script in the real environment.')
    parser.add_argument('--json-events', action='store_true', help='Output events in JSON format.')
    parser.add_argument('--batched', action='store_true', help='Enable batched test generation.')
    parser.add_argument('--batch-size', type=int, default=8, help='Maximum number of requirements to process in one batch.')
    parser.add_argument('--allow-partial', action='store_true', help='Allow partial test generation.')
    parser.add_argument('--allow-batch-partial', action='store_true', help='Allow partial test generation during batch processing.')
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

    # Group requirements by function
    if len(args.requirement_ids) == 0:
        requirements_to_check = requirements
    else:
        requirements_to_check = {}
        for req_id in args.requirement_ids:
            if req_id in requirements:
                requirements_to_check[req_id] = requirements[req_id]
            else:
                matching_reqs = {r: requirements[r] for r in requirements if r.startswith(req_id)}
                requirements_to_check.update(matching_reqs)

    grouped_requirements = group_requirements_by_function(requirements_to_check, args.batch_size)
    
    vectorcast_test_cases = []
    total_requirements = len(requirements_to_check)

    # Create progress bar for all requirements
    pbar = tqdm(total=total_requirements, desc="Generating tests")

    async def generate_and_process_requirement_group(requirement_ids):
        untested_requirements = set(requirement_ids)
        try:
            test_cases = test_generator.generate_test_cases(
                requirement_ids, 
                max_retries=args.retries, 
                batched=args.batched, 
                allow_partial=args.allow_partial,
                allow_batch_partial=args.allow_batch_partial
            )

            async for test_case in test_cases:
                if test_case.requirement_id in untested_requirements:
                    untested_requirements.remove(test_case.requirement_id)
                    pbar.update(1)  # Update progress for each completed requirement
                    
                if args.json_events:
                    print(json.dumps({'event': 'progress', 'value': pbar.n / total_requirements}), flush=True)

                if test_case:
                    logging.info("VectorCAST Test Case:\n%s", test_case.to_vectorcast())
                    vectorcast_test_cases.append(test_case.to_vectorcast())
        except Exception as e:
            import traceback
            traceback.print_exc()
            logging.error(f"Failed to generate test cases for requirements {untested_requirements}: {e}")
            test_case = None

    # Generate tests for all requirements
    await asyncio.gather(
        *[generate_and_process_requirement_group(req_ids) for req_ids in grouped_requirements.values()]
    )
    
    pbar.refresh()
    pbar.close()
    environment.cleanup()

    if args.export_tst:
        with open(args.export_tst, 'w') as output_file:
            for vectorcast_case in vectorcast_test_cases:
                output_file.write(vectorcast_case + '\n')

    if args.export_env:
        if not args.export_tst:
            with tempfile.NamedTemporaryFile(delete=False, suffix='.tst', mode='w') as temp_tst_file:
                tst_file_path = temp_tst_file.name
                for vectorcast_case in vectorcast_test_cases:
                    temp_tst_file.write(vectorcast_case + '\n')
        else:
            tst_file_path = args.export_tst

        # Instantiate real environment without sandbox
        real_environment = Environment(args.env_path, use_sandbox=False)

        # Run the test script in the real environment
        output = real_environment.run_test_script(tst_file_path)
        logging.info("Execution Output in real environment:\n%s", output)

        # Cleanup real environment
        real_environment.cleanup()

        # Remove temporary test script file if it was created
        if not args.export_tst:
            os.remove(tst_file_path)

    # Analyze info_logger data
    info_data = test_generator.info_logger.data

    # Derive individual test generation was necessary requirements
    individual_test_generation_needed = [req_id for req_id, data in info_data.items()
                                           if data['individual_test_generation_needed']]

    if individual_test_generation_needed:
        logging.warning("Individual test generation was necessary for the following requirements:")
        logging.warning(", ".join(individual_test_generation_needed))

        if args.json_events:
            print(json.dumps({'event': 'problem', 'value': f'Individual test generation was necessary for {", ".join(individual_test_generation_needed)}'}), flush=True)

    # Derive failed requirements
    failed_requirements = [req_id for req_id, data in info_data.items()
                           if not data['test_generated']]

    if failed_requirements:
        logging.warning("Failed to generate tests for the following requirements:")
        logging.warning(", ".join(failed_requirements))

        if args.json_events:
            print(json.dumps({'event': 'problem', 'value': f'Test generation failed for {", ".join(failed_requirements)}'}), flush=True)

    # Warn about requirements with test run failure feedback
    test_failure_requirements = [req_id for req_id, data in info_data.items()
                                 if data['test_run_failure_feedback'] and data['test_generated']]

    if test_failure_requirements:
        logging.warning("Failing tests were given as feedback for the following requirements:")
        logging.warning(", ".join(test_failure_requirements))

        if args.json_events:
            print(json.dumps({'event': 'problem', 'value': f'Failing tests were given as feedback for {", ".join(test_failure_requirements)}'}), flush=True)

    # After existing warning blocks, add new block for partial tests
    partial_test_requirements = [req_id for req_id, data in info_data.items()
                               if data['partial_test_generated']]

    if partial_test_requirements:
        logging.warning("Partial tests were generated for the following requirements:")
        logging.warning(", ".join(partial_test_requirements))

        if args.json_events:
            print(json.dumps({'event': 'problem', 'value': f'Partial tests were generated for {", ".join(partial_test_requirements)}'}), flush=True)

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


def cli():
    asyncio.run(main())

if __name__ == '__main__':
    cli()