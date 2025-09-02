import typing as t
import json
import logging
from pathlib import Path

from tqdm import tqdm

from .test_generation.environment import Environment
from .util import (
    expand_env_paths,
    generate_clicast_html_coverage_report,
    generate_custom_coverage_reports,
)


def coverage_report(
    envs: t.Union[str, t.List[str]],
    results_folder: t.Union[Path, str],
    output_dir: t.Union[Path, str] = 'reports',
    full_coverage_report: bool = False,
) -> None:
    results_folder = Path(results_folder)
    if not results_folder.is_dir():
        raise NotADirectoryError(
            f'Results folder does not exist or is not a directory: {results_folder}'
        )

    if not isinstance(envs, list):
        envs = [envs]
    envs = [Environment(env, use_sandbox=False) for env in envs]
    assert all(env.is_built for env in envs), (
        'All environments must be built before generating coverage reports.'
    )

    output_dir = Path(output_dir)
    output_dir.mkdir(exist_ok=True)

    for env in tqdm(envs, desc='Generating coverage reports for environments...'):
        verification_results_path = results_folder / f'{env.env_name}_result.json'
        if not verification_results_path.is_file():
            raise FileNotFoundError(
                f'Verification results file not found for environment: {env.env_file_path}'
            )
        with open(verification_results_path, 'r') as f:
            verification_results = json.load(f)

        coverage_file = generate_clicast_html_coverage_report(env)
        if not coverage_file:
            logging.error(
                f'Failed to generate coverage report for environment: {env.env_file_path}'
            )
            continue

        coverage_reports_out = output_dir / env.env_name / 'coverage_reports'
        coverage_reports_out.mkdir(parents=True, exist_ok=True)
        generate_custom_coverage_reports(
            env,
            coverage_file,
            verification_results['requirement_coverage_results'],
            coverage_reports_out,
            full_coverage_report=full_coverage_report,
        )
        coverage_file.unlink(missing_ok=True)


def cli():
    import argparse

    parser = argparse.ArgumentParser(
        description='Generate r2x reports',
    )
    parser.add_argument(
        'report_type',
        choices=('coverage',),
    )
    parser.add_argument(
        'envs',
        nargs='+',
        help='Paths to VectorCAST environments or path to a file containing environment paths, if preceded by "@".',
    )
    parser.add_argument(
        '--results-folder',
        help='Root folder of the r2t evaluation results (required for coverage reports).',
        required=False,
    )
    parser.add_argument(
        '--output-dir',
        help='Directory to save the generated reports.',
        required=False,
        default='reports',
    )
    parser.add_argument(
        '--full-coverage-report',
        action='store_true',
        help='Generate a full coverage report including all requirements, not just the uncovered ones.',
        default=False,
    )

    args = parser.parse_args()
    envs = expand_env_paths(args.envs)

    if args.report_type == 'coverage':
        if not args.results_folder:
            raise ValueError(
                'The --results-folder argument is required for coverage reports.'
            )
        coverage_report(
            envs,
            args.results_folder,
            args.output_dir,
            full_coverage_report=args.full_coverage_report,
        )
    else:
        raise NotImplementedError(f'Unsupported report type: {args.report_type}')


if __name__ == '__main__':
    cli()
