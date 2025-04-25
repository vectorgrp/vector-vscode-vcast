import json
import argparse
import asyncio
import logging
import os
import tempfile  # Add this import if not already present
from tqdm import tqdm

from autoreq.test_generation.requirement_decomposition import decompose_requirements
from .test_generation.generation import TestGenerator
from .test_generation.environment import Environment  # Ensure Environment is imported
from .requirements_manager import RequirementsManager, DecomposingRequirementsManager
from .util import ensure_env  # Add this import


async def main():
    parser = argparse.ArgumentParser(
        description="Generate and optionally execute test cases for given requirements."
    )
    parser.add_argument("env_path", help="Path to the VectorCAST environment file.")
    parser.add_argument(
        "requirements_file",
        help="Path to the CSV or Excel file containing requirements.",
        type=str,
    )
    parser.add_argument(
        "requirement_ids",
        nargs="*",
        help="ID of the requirement to generate test cases for.",
    )
    parser.add_argument(
        "--export-tst", help="Path to a file to write the VectorCAST test cases."
    )
    parser.add_argument(
        "--retries", type=int, default=2, help="Number of retries for test generation."
    )
    parser.add_argument(
        "--extended-reasoning",
        action="store_true",
        help="Use extended reasoning for test generation.",
    )
    parser.add_argument(
        "--export-env",
        action="store_true",
        help="Run the generated test script in the real environment.",
    )
    parser.add_argument(
        "--json-events", action="store_true", help="Output events in JSON format."
    )
    parser.add_argument(
        "--batched", action="store_true", help="Enable batched test generation."
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=8,
        help="Maximum number of requirements to process in one batch.",
    )
    parser.add_argument(
        "--allow-partial", action="store_true", help="Allow partial test generation."
    )
    parser.add_argument(
        "--allow-batch-partial",
        action="store_true",
        help="Allow partial test generation during batch processing.",
    )
    parser.add_argument(
        "--overwrite-env",
        action="store_true",
        help="Prompt user for environment variables even if they are already set.",
    )
    parser.add_argument(
        "--no-decomposition",
        action="store_true",
        help="Do not decompose requirements before generating tests.",
    )
    parser.add_argument(
        "--no-automatic-build",
        action="store_true",
        help="If the environment is not built, do not build it automatically.",
    )
    parser.add_argument(
        "--no-requirement-keys",
        action="store_true",
        help="Do not use requirement keys for test generation. Store a reference to the requirement in the notes instead",
    )
    args = parser.parse_args()

    log_level = os.environ.get("LOG_LEVEL", "WARNING").upper()
    numeric_level = getattr(logging, log_level, logging.INFO)
    logging.basicConfig(level=numeric_level)

    # Initialize the environment directly
    environment = Environment(args.env_path, use_sandbox=False)

    if not environment.is_built:
        if args.no_automatic_build:
            logging.error(
                "Environment is not built and --no-automatic-build is set. Exiting."
            )
            return
        else:
            logging.info("Environment is not built. Building it now...")
            environment.build()

    # Check if the environment has more than one unit, this is not supported for now
    if len(environment.units) > 1:
        logging.error("Multiple units in the environment are not supported.")
        return

    # Instantiate the requirements manager
    if not args.no_decomposition:
        rm = RequirementsManager(args.requirements_file)
        x = {req_id: rm.get_description(req_id) for req_id in rm.requirement_ids}

        decomposed = await decompose_requirements(list(x.values()))
        decomposed_req_map = {
            req_id: reqs for req_id, reqs in zip(rm.requirement_ids, decomposed)
        }

        async def decomposer(req):
            req_template = req.copy()
            # decomposed_req_descriptions = await decompose_requirement(req['Description'])
            decomposed_req_descriptions = decomposed_req_map[req["ID"]]
            decomposed_reqs = []
            for i, decomposed_req_description in enumerate(decomposed_req_descriptions):
                decomposed_req = req_template.copy()
                decomposed_req["ID"] = f"{req['ID']}.{i + 1}"
                decomposed_req["Description"] = decomposed_req_description
                decomposed_reqs.append(decomposed_req)
            logging.info("Original Requirement:", req["Description"])
            logging.info(
                "Decomposed Requirement:", [r["Description"] for r in decomposed_reqs]
            )
            return decomposed_reqs

        rm = await DecomposingRequirementsManager.from_file(
            args.requirements_file, decomposer=decomposer
        )
    else:
        rm = RequirementsManager(args.requirements_file)

    # Retrieve requirement IDs from the manager
    if len(args.requirement_ids) == 0:
        requirement_ids = rm.requirement_ids
    else:
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
                ]
            )
        requirement_ids = matched_ids

    test_generator = TestGenerator(
        rm,  # Pass the RequirementsManager instead of raw requirements
        environment=environment,
        use_extended_reasoning=args.extended_reasoning,
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
            batch_size=args.batch_size,
        ):
            if test_case:
                logging.info(
                    "VectorCAST Test Case:\n%s",
                    test_case.to_vectorcast(
                        use_requirement_key=not args.no_requirement_keys
                    ),
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

            pbar.update(1)
            if args.json_events:
                print(
                    json.dumps({"event": "progress", "value": pbar.n / pbar.total}),
                    flush=True,
                )

    except Exception as e:
        logging.error(f"Unexpected error during test generation: {e}")
        import traceback

        traceback.print_exc()
    finally:
        pbar.close()
        environment.cleanup()

    if args.export_tst:
        with open(args.export_tst, "w") as output_file:
            output_file.write("-- VectorCAST 6.4s (05/01/17)\n")
            output_file.write("-- Test Case Script\n")
            output_file.write(f"-- Environment    : {environment.env_name}\n")
            output_file.write(
                f"-- Unit(s) Under Test: {', '.join(environment.units)}\n"
            )
            output_file.write("-- \n")
            output_file.write("-- Script Features\n")
            output_file.write("TEST.SCRIPT_FEATURE:C_DIRECT_ARRAY_INDEXING\n")
            output_file.write("TEST.SCRIPT_FEATURE:CPP_CLASS_OBJECT_REVISION\n")
            output_file.write("TEST.SCRIPT_FEATURE:MULTIPLE_UUT_SUPPORT\n")
            output_file.write("TEST.SCRIPT_FEATURE:MIXED_CASE_NAMES\n")
            output_file.write("TEST.SCRIPT_FEATURE:STATIC_HEADER_FUNCS_IN_UUTS\n\n")
        with open(args.export_tst, "w") as output_file:
            for vectorcast_case in vectorcast_test_cases:
                output_file.write(vectorcast_case + "\n")

    if args.export_env:
        if not args.export_tst:
            with tempfile.NamedTemporaryFile(
                delete=False, suffix=".tst", mode="w"
            ) as temp_tst_file:
                tst_file_path = temp_tst_file.name
                for vectorcast_case in vectorcast_test_cases:
                    temp_tst_file.write(vectorcast_case + "\n")
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
    individual_test_generation_needed = [
        req_id
        for req_id, data in info_data.items()
        if data["individual_test_generation_needed"]
    ]

    if individual_test_generation_needed:
        logging.warning(
            "Individual test generation was necessary for the following requirements:"
        )
        logging.warning(", ".join(individual_test_generation_needed))

        if args.json_events:
            print(
                json.dumps(
                    {
                        "event": "problem",
                        "value": f"Individual test generation was necessary for {', '.join(individual_test_generation_needed)}",
                    }
                ),
                flush=True,
            )

    # Derive failed requirements
    failed_requirements = [
        req_id for req_id, data in info_data.items() if not data["test_generated"]
    ]

    if failed_requirements:
        logging.warning("Failed to generate tests for the following requirements:")
        logging.warning(", ".join(failed_requirements))

        if args.json_events:
            print(
                json.dumps(
                    {
                        "event": "problem",
                        "value": f"Test generation failed for {', '.join(failed_requirements)}",
                    }
                ),
                flush=True,
            )

    # Warn about requirements with test run failure feedback
    test_failure_requirements = [
        req_id
        for req_id, data in info_data.items()
        if data["test_run_failure_feedback"] and data["test_generated"]
    ]

    if test_failure_requirements:
        logging.warning(
            "Failing tests were given as feedback for the following requirements:"
        )
        logging.warning(", ".join(test_failure_requirements))

        if args.json_events:
            print(
                json.dumps(
                    {
                        "event": "problem",
                        "value": f"Failing tests were given as feedback for {', '.join(test_failure_requirements)}",
                    }
                ),
                flush=True,
            )

    # After existing warning blocks, add new block for partial tests
    partial_test_requirements = [
        req_id for req_id, data in info_data.items() if data["partial_test_generated"]
    ]

    if partial_test_requirements:
        logging.warning("Partial tests were generated for the following requirements:")
        logging.warning(", ".join(partial_test_requirements))

        if args.json_events:
            print(
                json.dumps(
                    {
                        "event": "problem",
                        "value": f"Partial tests were generated for {', '.join(partial_test_requirements)}",
                    }
                ),
                flush=True,
            )

    # Get token usage and total cost from LLMClient
    token_usage = test_generator.llm_client.get_token_usage()
    total_cost_info = test_generator.llm_client.total_cost

    # Display token usage and costs
    logging.info("Token Usage and Costs:")
    logging.info(
        f"Generation Model - Input Tokens: {token_usage['generation']['input_tokens']}"
    )
    logging.info(
        f"Generation Model - Output Tokens: {token_usage['generation']['output_tokens']}"
    )
    logging.info(
        f"Reasoning Model - Input Tokens: {token_usage['reasoning']['input_tokens']}"
    )
    logging.info(
        f"Reasoning Model - Output Tokens: {token_usage['reasoning']['output_tokens']}"
    )
    logging.info(
        f"Total Tokens: {token_usage['generation']['input_tokens'] + token_usage['generation']['output_tokens'] + token_usage['reasoning']['input_tokens'] + token_usage['reasoning']['output_tokens']}"
    )

    logging.info(
        f"Generation Model - Input Cost: ${total_cost_info['generation']['input_cost']:.6f}"
    )
    logging.info(
        f"Generation Model - Output Cost: ${total_cost_info['generation']['output_cost']:.6f}"
    )
    logging.info(
        f"Reasoning Model - Input Cost: ${total_cost_info['reasoning']['input_cost']:.6f}"
    )
    logging.info(
        f"Reasoning Model - Output Cost: ${total_cost_info['reasoning']['output_cost']:.6f}"
    )
    logging.info(f"Total Cost: ${total_cost_info['total_cost']:.6f}")

    # Save info logger data to a JSON file
    # with open('info_logger.json', 'w') as info_file:
    #    json.dump(info_data, info_file, indent=4)


def cli():
    asyncio.run(main())


if __name__ == "__main__":
    cli()
