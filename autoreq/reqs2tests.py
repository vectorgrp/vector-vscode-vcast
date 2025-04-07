import json
import argparse
import asyncio
import logging
import os
import tempfile  # Add this import if not already present
from tqdm import tqdm
from .test_generation.generation import TestGenerator
from .test_generation.environment import Environment  # Ensure Environment is imported
from .requirements_manager import RequirementsManager  # Add this import
from .util import ensure_env  # Add this import

def prompt_user_for_info(key):
    if key == 'OPENAI_API_KEY':
        return input("Please enter your OpenAI API key: ")
    elif key == 'OPENAI_GENERATION_DEPLOYMENT':
        return input("Please enter the OpenAI deployment for generation: ")
    elif key == 'OPENAI_ADVANCED_GENERATION_DEPLOYMENT':
        return input("Please enter the OpenAI deployment for advanced generation: ")
    elif key == 'OPENAI_API_BASE':
        return input("Please enter the OpenAI API base URL: ")

async def main():
    parser = argparse.ArgumentParser(description='Generate and optionally execute test cases for given requirements.')
    parser.add_argument('env_path', help='Path to the VectorCAST environment file.')
    parser.add_argument('requirements_file', help='Path to the CSV or Excel file containing requirements.')
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
    parser.add_argument('--overwrite-env', action='store_true', help='Prompt user for environment variables even if they are already set.')
    args = parser.parse_args()

    ensure_env(['OPENAI_API_KEY', 'OPENAI_API_BASE', 'OPENAI_GENERATION_DEPLOYMENT', 'OPENAI_ADVANCED_GENERATION_DEPLOYMENT'], 
               fallback=prompt_user_for_info, 
               force_fallback=args.overwrite_env)

    log_level = os.environ.get('LOG_LEVEL', 'WARNING').upper()
    numeric_level = getattr(logging, log_level, logging.INFO)
    logging.basicConfig(level=numeric_level)

    # Initialize the environment directly
    environment = Environment(args.env_path)

    environment.build()

    # Instantiate the requirements manager
    rm = RequirementsManager(args.requirements_file)

    # Retrieve requirement IDs from the manager
    if len(args.requirement_ids) == 0:
        requirement_ids = rm.requirement_ids
    else:
        # Filter for direct matches or prefix matches as before
        matched_ids = []
        for rid in args.requirement_ids:
            # Instead of building a local dict, track requirement IDs
            matched_ids.extend([
                req_id for req_id in rm.requirement_ids
                if req_id == rid or req_id.startswith(rid)
            ])
        requirement_ids = matched_ids

    test_generator = TestGenerator(
        rm,  # Pass the RequirementsManager instead of raw requirements
        environment=environment, 
        use_extended_reasoning=args.extended_reasoning
    )

    vectorcast_test_cases = []
    pbar = tqdm(total=len(requirement_ids), desc="Generating tests")

    try:
        async for test_case in test_generator.generate_test_cases(
            requirement_ids, 
            max_retries=args.retries, 
            batched=args.batched, 
            allow_partial=args.allow_partial,
            allow_batch_partial=args.allow_batch_partial,
            batch_size=args.batch_size
        ):
            if test_case:
                logging.info("VectorCAST Test Case:\n%s", test_case.to_vectorcast())
                vectorcast_test_cases.append(test_case.to_vectorcast())
            
            pbar.update(1)
            if args.json_events:
                print(json.dumps({'event': 'progress', 'value': pbar.n / pbar.total}), flush=True)

    except Exception as e:
        logging.error(f"Unexpected error during test generation: {e}")
        import traceback
        traceback.print_exc()
    finally:
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
    #with open('info_logger.json', 'w') as info_file:
    #    json.dump(info_data, info_file, indent=4)


def cli():
    asyncio.run(main())

if __name__ == '__main__':
    cli()