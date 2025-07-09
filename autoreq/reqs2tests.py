import json
import argparse
import asyncio
import logging
import os
import tempfile  # Add this import if not already present
from tqdm import tqdm
import traceback

from autoreq.test_generation.requirement_decomposition import decompose_requirements
from autoreq.aq_logging import configure_logging
from .test_generation.generation import TestGenerator
from .test_generation.environment import Environment  # Ensure Environment is imported
from .requirements_manager import (
    ID_FIELD,
    RequirementsManager,
    DecomposingRequirementsManager,
)


async def init_requirements_manager(args: argparse.Namespace):
    if not args.no_decomposition:
        rm = RequirementsManager(args.requirements_file)
        x = {req_id: rm.get_description(req_id) for req_id in rm.requirement_ids}

        decomposed = await decompose_requirements(
            list(x.values()),
            individual=args.individual_decomposition,
            k=5,
            threshold_frequency=0.2,
        )
        decomposed_req_map = {
            req_id: reqs for req_id, reqs in zip(rm.requirement_ids, decomposed)
        }

        async def decomposer(req):
            req_template = req.copy()
            # decomposed_req_descriptions = await decompose_requirement(req['Description'])
            decomposed_req_descriptions = decomposed_req_map[req[ID_FIELD]]
            decomposed_reqs = []
            for i, decomposed_req_description in enumerate(decomposed_req_descriptions):
                decomposed_req = req_template.copy()
                decomposed_req[ID_FIELD] = f'{req[ID_FIELD]}.{i + 1}'
                decomposed_req['Description'] = decomposed_req_description
                decomposed_reqs.append(decomposed_req)
            logging.info(
                'Requirement decomposition',
                extra={
                    'requirement_id': req[ID_FIELD],
                    'decomposed_count': len(decomposed_reqs),
                    'original_requirement': req['Description'],
                    'decomposed_requirements': [
                        r['Description'] for r in decomposed_reqs
                    ],
                },
            )

            if len(decomposed_reqs) > 1:
                print('Decomposed requirement:')
                print('Original:', req['Description'])
                print(
                    'Decomposed:',
                    [r['Description'] for r in decomposed_reqs],
                )

            return decomposed_reqs

        return await DecomposingRequirementsManager.from_file(
            args.requirements_file, decomposer=decomposer
        )

    return RequirementsManager(args.requirements_file)


def get_requirement_ids(rm, args: argparse.Namespace):
    if len(args.requirement_ids) == 0:
        return rm.requirement_ids

    # Filter for direct matches or prefix matches as before
    matched_ids = []
    for rid in args.requirement_ids:
        # Instead of building a local dict, track requirement IDs
        matched_ids.extend(
            [
                req_id
                for req_id in rm.requirement_ids
                if req_id == rid
                or req_id.startswith(rid)
                or rm.get_function(req_id) == rid
                or rm.get_module(req_id) == rid
            ]
        )
    return matched_ids


async def generate_tests(
    test_generator: TestGenerator,
    environment: Environment,
    requirement_ids: list,
    rm,
    args: argparse.Namespace,
):
    vectorcast_test_cases = []
    pbar = tqdm(total=len(requirement_ids), desc='Generating tests')

    try:
        async for test_case in test_generator.generate_test_cases(
            requirement_ids,
            max_retries=args.retries,
            batched=args.batched,
            allow_partial=args.allow_partial,
            allow_batch_partial=args.allow_batch_partial,
            batch_size=args.batch_size,
        ):
            pbar.update(1)
            if args.json_events:
                print(
                    json.dumps({'event': 'progress', 'value': pbar.n / pbar.total}),
                    flush=True,
                )
            if not test_case:
                continue

            logging.info(
                'VectorCAST Test Case',
                extra={
                    'requirement_id': test_case.requirement_id,
                    'test_case': test_case.to_vectorcast(
                        use_requirement_key=not args.no_requirement_keys
                    ),
                },
            )

            # Map back to original requirement ID
            if not args.no_decomposition:
                original_req_id = rm.get_original_requirement_id(
                    test_case.requirement_id
                )
                test_case.requirement_id = original_req_id

            vectorcast_test_cases.append(
                test_case.to_vectorcast(
                    use_requirement_key=not args.no_requirement_keys
                )
            )

    except Exception as e:
        stacktrace = traceback.format_exc()
        logging.error(
            'Unexpected error during test generation',
            extra={
                'stacktrace': stacktrace,
                'error': str(e),
            },
        )
        traceback.print_exc()
    finally:
        pbar.close()
        environment.cleanup()

    return vectorcast_test_cases


def export_env(args: argparse.Namespace, vectorcast_test_cases: list):
    if args.export_env:
        tst_file_path = args.export_tst
        if not args.export_tst:
            with tempfile.NamedTemporaryFile(
                delete=False, suffix='.tst', mode='w'
            ) as temp_tst_file:
                tst_file_path = temp_tst_file.name
                for vectorcast_case in vectorcast_test_cases:
                    temp_tst_file.write(vectorcast_case + '\n')

        # Instantiate real environment without sandbox
        real_environment = Environment(args.env_path, use_sandbox=False)

        # Run the test script in the real environment
        output = real_environment.run_test_script(tst_file_path)
        logging.info(
            'Execution Output in real environment',
            extra={
                'tst_file_path': str(tst_file_path),
                'output': str(output),
            },
        )

        # Cleanup real environment
        real_environment.cleanup()

        # Remove temporary test script file if it was created
        if not args.export_tst:
            os.remove(tst_file_path)


async def main():
    parser = argparse.ArgumentParser(
        description='Generate and optionally execute test cases for given requirements.'
    )
    parser.add_argument('env_path', help='Path to the VectorCAST environment file.')
    parser.add_argument(
        'requirements_file',
        help='Path to the CSV or Excel file containing requirements.',
        type=str,
    )
    parser.add_argument(
        'requirement_ids',
        nargs='*',
        help='ID of the requirement to generate test cases for.',
    )
    parser.add_argument(
        '--export-tst', help='Path to a file to write the VectorCAST test cases.'
    )
    parser.add_argument(
        '--retries', type=int, default=2, help='Number of retries for test generation.'
    )
    parser.add_argument(
        '--extended-reasoning',
        action='store_true',
        help='Use extended reasoning for test generation.',
    )
    parser.add_argument(
        '--export-env',
        action='store_true',
        help='Run the generated test script in the real environment.',
    )
    parser.add_argument(
        '--json-events', action='store_true', help='Output events in JSON format.'
    )
    parser.add_argument(
        '--batched', action='store_true', help='Enable batched test generation.'
    )
    parser.add_argument(
        '--batch-size',
        type=int,
        default=4,
        help='Maximum number of requirements to process in one batch.',
    )
    parser.add_argument(
        '--allow-partial', action='store_true', help='Allow partial test generation.'
    )
    parser.add_argument(
        '--allow-batch-partial',
        action='store_true',
        help='Allow partial test generation during batch processing.',
    )
    parser.add_argument(
        '--overwrite-env',
        action='store_true',
        help='Prompt user for environment variables even if they are already set.',
    )
    parser.add_argument(
        '--no-decomposition',
        action='store_true',
        help='Do not decompose requirements before generating tests.',
    )
    parser.add_argument(
        '--individual-decomposition', action='store_true', help=argparse.SUPPRESS
    )
    parser.add_argument(
        '--no-automatic-build',
        action='store_true',
        help='If the environment is not built, do not build it automatically.',
    )
    parser.add_argument(
        '--no-requirement-keys',
        action='store_true',
        help='Do not use requirement keys for test generation. Store a reference to the requirement in the notes instead',
    )
    parser.add_argument(
        '--blackbox',
        action='store_true',
        help='Generate blackbox tests instead of supplying the language model with the source code of the function under test.',
    )
    parser.add_argument(
        '--min-pruning-lines', type=int, default=1000, help=argparse.SUPPRESS
    )
    parser.add_argument(
        '--no-test-examples',
        action='store_true',
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()

    configure_logging('reqs2tests')

    # Initialize the environment directly
    environment = Environment(args.env_path, use_sandbox=False)

    if not environment.is_built:
        if args.no_automatic_build:
            logging.error(
                'Environment is not built and --no-automatic-build is set. Exiting.'
            )
            return
        logging.info('Environment is not built. Building it now...')
        environment.build()

    # Instantiate the requirements manager
    rm = await init_requirements_manager(args)

    # Retrieve requirement IDs from the manager
    requirement_ids = get_requirement_ids(rm, args)

    test_generator = TestGenerator(
        rm,  # Pass the RequirementsManager instead of raw requirements
        environment=environment,
        use_extended_reasoning=args.extended_reasoning,
        min_prune_lines=args.min_pruning_lines,
        use_test_examples=not args.no_test_examples,
        blackbox=args.blackbox,
    )

    vectorcast_test_cases = await generate_tests(
        test_generator, environment, requirement_ids, rm, args
    )

    if args.export_tst:
        with open(args.export_tst, 'w') as output_file:
            output_file.write('-- VectorCAST 6.4s (05/01/17)\n')
            output_file.write('-- Test Case Script\n')
            output_file.write(f'-- Environment    : {environment.env_name}\n')
            output_file.write(
                f'-- Unit(s) Under Test: {", ".join(environment.units)}\n'
            )
            output_file.write('-- \n')
            output_file.write('-- Script Features\n')
            output_file.write('TEST.SCRIPT_FEATURE:C_DIRECT_ARRAY_INDEXING\n')
            output_file.write('TEST.SCRIPT_FEATURE:CPP_CLASS_OBJECT_REVISION\n')
            output_file.write('TEST.SCRIPT_FEATURE:MULTIPLE_UUT_SUPPORT\n')
            output_file.write('TEST.SCRIPT_FEATURE:MIXED_CASE_NAMES\n')
            output_file.write('TEST.SCRIPT_FEATURE:STATIC_HEADER_FUNCS_IN_UUTS\n\n')

            for vectorcast_case in vectorcast_test_cases:
                output_file.write(vectorcast_case + '\n')

    export_env(args, vectorcast_test_cases)

    # Analyze info_logger data
    info_data = test_generator.info_logger.data

    # Derive individual test generation was necessary requirements
    individual_test_generation_needed = [
        req_id
        for req_id, data in info_data.items()
        if data['individual_test_generation_needed']
    ]

    if individual_test_generation_needed:
        logging.warning(
            'Individual test generation was necessary for the requirements',
            extra={
                'individual_test_generation_needed': individual_test_generation_needed,
                'count': len(individual_test_generation_needed),
            },
        )

        if args.json_events:
            print(
                json.dumps(
                    {
                        'event': 'problem',
                        'value': f'Individual test generation was necessary for {", ".join(individual_test_generation_needed)}',
                    }
                ),
                flush=True,
            )

    # Derive failed requirements
    failed_requirements = [
        req_id for req_id, data in info_data.items() if not data['test_generated']
    ]

    if failed_requirements:
        logging.warning(
            'Test generation failed for requirements',
            extra={
                'failed_requirements': failed_requirements,
                'count': len(failed_requirements),
            },
        )

        if args.json_events:
            print(
                json.dumps(
                    {
                        'event': 'problem',
                        'value': f'Test generation failed for {", ".join(failed_requirements)}',
                    }
                ),
                flush=True,
            )

    # Warn about requirements with test run failure feedback
    test_failure_requirements = [
        req_id
        for req_id, data in info_data.items()
        if data['test_run_failure_feedback'] and data['test_generated']
    ]

    if test_failure_requirements:
        logging.warning(
            'Failing tests were given as feedback for the requirements',
            extra={
                'test_failure_requirements': test_failure_requirements,
                'count': len(test_failure_requirements),
            },
        )
        if args.json_events:
            print(
                json.dumps(
                    {
                        'event': 'problem',
                        'value': f'Failing tests were given as feedback for {", ".join(test_failure_requirements)}',
                    }
                ),
                flush=True,
            )

    # After existing warning blocks, add new block for partial tests
    partial_test_requirements = [
        req_id for req_id, data in info_data.items() if data['partial_test_generated']
    ]

    if partial_test_requirements:
        logging.warning(
            'Partial tests were generated for the requirements',
            extra={
                'partial_test_requirements': partial_test_requirements,
                'count': len(partial_test_requirements),
            },
        )
        if args.json_events:
            print(
                json.dumps(
                    {
                        'event': 'problem',
                        'value': f'Partial tests were generated for {", ".join(partial_test_requirements)}',
                    }
                ),
                flush=True,
            )

    # Get token usage and total cost from LLMClient
    token_usage = test_generator.llm_client.get_token_usage()
    total_cost_info = test_generator.llm_client.total_cost

    # Display token usage and costs
    logging.info(
        'Token Usage and Costs',
        extra={
            'gen_model_input_tokens': token_usage['generation']['input_tokens'],
            'gen_model_output_tokens': token_usage['generation']['output_tokens'],
            'reasoning_model_input_tokens': token_usage['reasoning']['input_tokens'],
            'reasoning_model_output_tokens': token_usage['reasoning']['output_tokens'],
            'total_tokens': (
                token_usage['generation']['input_tokens']
                + token_usage['generation']['output_tokens']
                + token_usage['reasoning']['input_tokens']
                + token_usage['reasoning']['output_tokens']
            ),
            'gen_model_input_cost': total_cost_info['generation']['input_cost'],
            'gen_model_output_cost': total_cost_info['generation']['output_cost'],
            'reasoning_model_input_cost': total_cost_info['reasoning']['input_cost'],
            'reasoning_model_output_cost': total_cost_info['reasoning']['output_cost'],
            'total_cost': total_cost_info['total_cost'],
        },
    )

    # Save info logger data to a JSON file
    # with open('info_logger.json', 'w') as info_file:
    #    json.dump(info_data, info_file, indent=4)


def cli():
    asyncio.run(main())


if __name__ == '__main__':
    cli()
