import os.path
import typing as t
from pathlib import Path
import json


from .code2reqs import execute_rgw_commands, save_requirements_to_excel
from .test_generation.environment import Environment
from .trace_reqs2code import Reqs2CodeMapper
from .util import configure_logging, expand_env_paths
import asyncio
import logging


def load_requirements_from_gateway(rgw_path: Path) -> t.List[t.Dict]:
    requirements_json_path = rgw_path / 'requirements.json'
    assert requirements_json_path.is_file(), (
        'The requirements gateway does not contain a requirements.json file.'
    )
    with open(requirements_json_path, 'r') as f:
        data = json.load(f)

    ret = []
    for group_id, reqs_info in data.items():
        for req_id, req in reqs_info.items():
            ret.append(req)
    return ret


def requirements_to_xlsx(
    envs: t.Union[Environment, t.List[Environment]],
    requirements_info,
    output_file: t.Union[str, Path],
    from_rgw: bool = False,
    automatic_traceability: bool = False,
) -> None:
    # For now, we assume one requirements gateway/csv file per environment.
    if not isinstance(envs, list):
        envs = [envs]

    env_path_to_env = {}
    for env in envs:
        env_path_to_env[env.env_file_path] = env

    logging.info('Automatic matching of requirements to functions in progress...')
    reqs2code_mapper = Reqs2CodeMapper()
    reqs2code_mapping = {}
    real_requirements = {}
    formatted_requirements = []

    if from_rgw:
        real_requirements = [req['description'] for req in requirements_info]
        try:
            if automatic_traceability:
                reqs2code_mapping = asyncio.run(
                    reqs2code_mapper.map_reqs_to_code_for_env(
                        envs[0].env_file_path, real_requirements
                    )
                )
                logging.info(
                    'Automatic matching of requirements to functions finished, generating Excel file to be reviewed...'
                )
            else:
                reqs2code_mapping = {}
        except Exception as e:
            logging.error(
                'Error occurred during automatic matching requirements to functions: %s',
                str(e),
            )
            logging.info(
                'Generating Excel file with requirements and functions for manual matching and review...'
            )
            pass

        format_env_requirements(
            requirements_info, reqs2code_mapping, formatted_requirements, envs[0]
        )

    else:
        real_requirements_per_env = {
            env_path: [req['description'] for req in reqs_info]
            for env_path, reqs_info in requirements_info.items()
        }
        try:
            if automatic_traceability:
                reqs2code_mapping = asyncio.run(
                    reqs2code_mapper.map_reqs_to_code_for_env_list(
                        real_requirements_per_env
                    )
                )
                logging.info(
                    'Automatic matching of requirements to functions finished, generating Excel file to be reviewed...'
                )
            else:
                reqs2code_mapping = {}
        except Exception as e:
            logging.error(
                'Error occurred during automatic matching requirements to functions: %s',
                str(e),
            )
            logging.info(
                'Generating Excel file with requirements and functions for manual matching and review...'
            )
            pass

        for env_file_path, _requirements_info in requirements_info.items():
            environment: Environment = env_path_to_env[env_file_path]
            format_env_requirements(
                _requirements_info,
                reqs2code_mapping[env_file_path],
                formatted_requirements,
                environment,
            )

    save_requirements_to_excel(
        formatted_requirements,
        envs,
        output_file,
    )


def format_env_requirements(
    requirements_info,
    reqs2code_mapping,
    formatted_requirements: t.List[t.Dict],
    environment: Environment,
):
    for req in requirements_info:
        req_id = req['id']
        related_function_name = ''
        if reqs2code_mapping:
            related_function_name = reqs2code_mapping[req['description']]

        func_info = next(
            (
                func
                for func in environment.testable_functions
                if func['name'] == related_function_name
            ),
            None,
        )

        if not func_info:
            logging.info(
                'No function found for requirement %s, assigning None',
                req['description'],
            )
            related_function_name = 'None'

        requirement = {
            'Key': req_id,
            'ID': req_id,
            'Title': req['title'],
            'Description': req['description'],
            'Module': func_info['unit_name'] if func_info else 'None',
            'Function': related_function_name,
        }
        formatted_requirements.append(requirement)


def main(
    env_paths,
    output_file: t.Union[str, Path],
    requirements_gateway_path: t.Union[str, Path] = None,
    init_requirements: bool = False,
    csv_template_path: t.Union[str, Path] = None,
    automatic_traceability: bool = False,
    no_automatic_build: bool = False,
) -> None:
    envs = [Environment(env, use_sandbox=False) for env in expand_env_paths(env_paths)]

    for env in envs:
        if not env.is_built:
            if no_automatic_build:
                logging.error(
                    f'Environment {env.env_name} is not built and --no-automatic-build is set. Exiting.'
                )
                return
            logging.info(f'Environment {env.env_name} is not built. Building it now...')
            env.build()

    from_rgw = False
    if init_requirements:
        assert csv_template_path, (
            'The CSV template path is required when initializing requirements.'
        )
        csv_template_path = Path(os.path.expandvars(csv_template_path))
        assert csv_template_path.is_file(), 'The CSV template file does not exist.'
        requirements = {}
        for env in envs:
            rgw_path = Path(env.env_dir) / 'requirements_gateway'
            requirements_json_path = rgw_path / 'requirements.json'
            if not (rgw_path.is_dir() and requirements_json_path.is_file()):
                execute_rgw_commands(
                    env.env_file_path, csv_template_path, str(env.env_dir)
                )
            requirements[env.env_file_path] = load_requirements_from_gateway(rgw_path)
    else:
        assert requirements_gateway_path, (
            'The requirements gateway path is required when not initializing requirements.'
        )
        requirements_gateway_path = Path(os.path.expandvars(requirements_gateway_path))
        assert requirements_gateway_path.is_dir(), (
            'The requirements gateway directory does not exist.'
        )
        assert len(envs) == 1, (
            'Only one environment per requirements gateway is supported for now.'
        )
        requirements = load_requirements_from_gateway(requirements_gateway_path)
        from_rgw = True

    requirements_to_xlsx(
        envs,
        requirements,
        output_file,
        from_rgw,
        automatic_traceability=automatic_traceability,
    )
    for env in envs:
        env.cleanup()


def cli():
    import argparse

    parser = argparse.ArgumentParser(
        description='Import requirements and export them to Excel for reviewing requirement<->function links'
    )
    parser.add_argument(
        'envs',
        nargs='+',
        help='Paths to VectorCAST environments or path to a file containing environment paths, if preceded by "@".',
    )
    parser.add_argument(
        '--requirements-gateway-path',
        help='Path to the requirements gateway folder',
        required=False,
    )
    parser.add_argument(
        '--csv-template',
        help='Path to the CSV template for requirements.',
        required=False,
    )
    parser.add_argument(
        '--output-file',
        help='Path to the output Excel file.',
        required=False,
        default='requirements.xlsx',
    )
    parser.add_argument(
        '--init-requirements',
        action='store_true',
        help='Initialize requirements from CSV files in the environments.',
        default=False,
        required=False,
    )
    parser.add_argument(
        '--automatic-traceability',
        action='store_true',
        help='Enable automatic traceability.',
        default=False,
        required=False,
    )
    parser.add_argument(
        '--no-automatic-build',
        action='store_true',
        help='Do not automatically build the environments if they are not built.',
        default=False,
        required=False,
    )

    args = parser.parse_args()

    configure_logging()

    main(
        args.envs,
        args.output_file,
        args.requirements_gateway_path,
        init_requirements=args.init_requirements,
        csv_template_path=args.csv_template,
        automatic_traceability=args.automatic_traceability,
    )


if __name__ == '__main__':
    cli()
