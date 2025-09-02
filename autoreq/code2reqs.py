import argparse
import json
from tqdm.asyncio import tqdm_asyncio
import asyncio
import logging

from autoreq.requirements_collection import RequirementsCollection
from autoreq.aq_logging import configure_logging

from .test_generation.environment import Environment
from .requirement_generation.generation import RequirementsGenerator
from .requirement_generation.high_level_generation import HighLevelRequirementsGenerator


async def main(
    env_path,
    export_csv=None,
    export_excel=None,
    export_html=None,
    export_repository=None,
    json_events=False,
    combine_related_requirements=False,
    extended_reasoning=False,
    no_automatic_build=False,
    export_line_number=False,
    generate_high_level_requirements=False,
):
    if export_line_number:
        logging.warning(
            "Disabling post-processing of requirements to allow export of covered line numbers"
        )

    environment = Environment(env_path, use_sandbox=False)

    if not environment.is_built:
        if no_automatic_build:
            logging.error(
                "Environment is not built and --no-automatic-build is set. Exiting."
            )
            return
        else:
            logging.info("Environment is not built. Building it now...")
            environment.build()

    functions = environment.testable_functions

    generator = RequirementsGenerator(
        environment,
        combine_related_requirements=combine_related_requirements,
        extended_reasoning=extended_reasoning,
    )

    low_level_requirements = RequirementsCollection()

    # Initialize progress tracking
    total_functions = len(functions)
    processed_functions = 0

    async def generate_requirements(func):
        nonlocal processed_functions
        func_name = func["name"]
        result = await generator.generate(
            func_name,
            post_process_requirements=not export_line_number,
        )
        processed_functions += 1
        progress = processed_functions / total_functions

        if json_events:
            print(json.dumps({"event": "progress", "value": progress}), flush=True)

        low_level_requirements.extend(result)

    await tqdm_asyncio.gather(*[generate_requirements(func) for func in functions])

    if generate_high_level_requirements:
        high_level_generator = HighLevelRequirementsGenerator(
            environment,
            low_level_requirements=low_level_requirements,
            extended_reasoning=extended_reasoning,
        )

        async def generate_high_level_requirements_for_unit(unit):
            unit_high_level_reqs = await high_level_generator.generate(unit)
            if unit_high_level_reqs:
                low_level_requirements.extend(unit_high_level_reqs)

        await tqdm_asyncio.gather(
            *[
                generate_high_level_requirements_for_unit(unit)
                for unit in environment.units
            ]
        )

    info_data = generator.info_logger.data

    failed_functions = [
        req_id
        for req_id, data in info_data.items()
        if data["requirement_generation_failed"]
    ]

    if failed_functions:
        logging.warning(
            "Requirement generation failed for functions",
            extra={
                "failed_functions": failed_functions,
                "count": len(failed_functions),
            },
        )

    # Log high-level requirement generation failures if applicable
    if generate_high_level_requirements:
        high_level_info_data = high_level_generator.info_logger.data

        failed_units = [
            unit_name
            for unit_name, data in high_level_info_data.items()
            if data["high_level_generation_failed"]
        ]

        if failed_units:
            logging.warning(
                "High-level requirement generation failed for units",
                extra={
                    "failed_units": failed_units,
                    "count": len(failed_units),
                },
            )

    req_collection = RequirementsCollection(low_level_requirements)

    if export_csv:
        req_collection.to_csv(export_csv)

    if export_excel:
        req_collection.to_excel(export_excel, source_envs=[environment])

    if export_html:
        req_collection.to_html(export_html)

    if export_repository:
        req_collection.to_rgw(export_repository)

    environment.cleanup()

    return generator.llm_client.total_cost["total_cost"], low_level_requirements


def cli():
    parser = argparse.ArgumentParser(
        description="Decompose design of functions into requirements."
    )
    parser.add_argument(
        "env_path", help="Path to the VectorCAST environment directory."
    )
    parser.add_argument(
        "--export-csv", help="Path to the output CSV file for requirements."
    )
    parser.add_argument(
        "--export-html",
        help="Optional path to the output HTML file for pretty-printed requirements.",
    )
    parser.add_argument(
        "--export-excel",
        help="Path to the output Excel file for requirements.",
    )
    parser.add_argument(
        "--export-repository",
        help="Path to the VCAST_REPOSITORY for registering requirements.",
    )
    parser.add_argument(
        "--json-events", action="store_true", help="Output events in JSON format."
    )
    parser.add_argument(
        "--overwrite-env",
        action="store_true",
        help="Prompt user for environment variables even if they are already set.",
    )
    parser.add_argument(
        "--combine-related-requirements",
        action="store_true",
        help="Combine related requirements into a single requirement after initial generation.",
    )
    parser.add_argument(
        "--extended-reasoning",
        action="store_true",
        help="Use extended reasoning for test generation.",
    )
    parser.add_argument(
        "--no-automatic-build",
        action="store_true",
        help="If the environment is not built, do not build it automatically.",
    )
    parser.add_argument(
        "--export-covered-lines",
        action="store_true",
        help=argparse.SUPPRESS,  # Controls if lines covered by the requirement are exported
    )
    parser.add_argument(
        "--generate-high-level-requirements",
        action="store_true",
        help="Also generate high-level requirements.",
    )

    args = parser.parse_args()

    configure_logging("code2reqs")

    asyncio.run(
        main(
            args.env_path,
            args.export_csv,
            args.export_excel,
            args.export_html,
            args.export_repository,
            json_events=args.json_events,
            extended_reasoning=args.extended_reasoning,
            no_automatic_build=args.no_automatic_build,
            export_line_number=args.export_covered_lines,
            generate_high_level_requirements=args.generate_high_level_requirements,
        )
    )


if __name__ == "__main__":
    cli()
