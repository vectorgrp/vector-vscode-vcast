import asyncio
import argparse
from autoreq.requirements_collection import RequirementsCollection
from autoreq.test_generation.environment import Environment
from autoreq.trace_reqs2code import Reqs2CodeMapper
from autoreq.util import are_paths_equal


async def main(
    source_path,
    target_path,
    target_format,
    target_env_path=None,
    infer_traceability=False,
):
    if target_env_path:
        target_env = Environment(target_env_path, use_sandbox=False)
    else:
        target_env = None

    requirements = RequirementsCollection.from_path(source_path)

    if infer_traceability:
        if not target_env:
            raise ValueError(
                'When inferring traceability, a target environment must be provided.'
            )

        req_traceability_mapper = Reqs2CodeMapper(target_env)
        requirements = await req_traceability_mapper.map_requirements_to_code(
            requirements
        )

    if target_format == 'excel':
        requirements.to_excel(target_path)
    elif target_format == 'csv':
        requirements.to_csv(target_path)
    elif target_format == 'rgw':
        only_update_traceability = infer_traceability and are_paths_equal(
            source_path, target_path
        )
        requirements.to_rgw(
            target_path,
            target_env=target_env,
            only_traceability=only_update_traceability,
        )
    else:
        raise ValueError(f'Unsupported target format: {target_format}')


def cli():
    parser = argparse.ArgumentParser(
        description='Convert requirements from one format to another.'
    )
    parser.add_argument('source_path', help='Path to the source requirements file.')
    parser.add_argument(
        'target_path', help='Path to save the converted requirements file.'
    )
    parser.add_argument(
        '--target-format',
        choices=['excel', 'csv', 'rgw'],
        required=True,
        help='Format to convert the requirements to.',
    )
    parser.add_argument(
        '--target-env',
        help='Path to the target environment for traceability mapping (required if inferring traceability).',
    )
    parser.add_argument(
        '--infer-traceability',
        action='store_true',
        help='Infer traceability from requirements to code.',
    )

    args = parser.parse_args()

    asyncio.run(
        main(
            args.source_path,
            args.target_path,
            args.target_format,
            args.target_env,
            args.infer_traceability,
        )
    )
