import os
import sys
import json
import argparse

from pathlib import Path

assertions = {
    'sanity': {
        'envs': {
            'TUTORIAL_C': {
                'coverage.branches.percentage': {'min': 0.75},
                'coverage.statements.percentage': {'min': 0.75},
                'f1_score': {'min': 0.6},
            },
            'COMMON__PUT_LEAKY_BUCKET_F32_FN': {
                'coverage.branches.percentage': {'min': 0.75},
                'coverage.statements.percentage': {'min': 0.75},
                'f1_score': {'min': 0.6},
            },
            'SRC__MODMGR4A': {
                'coverage.branches.percentage': {'min': 0.75},
                'coverage.statements.percentage': {'min': 0.75},
                'f1_score': {'min': 0.6},
            },
        }
    },
    'piinnovo': {'envs': {}},
    'atg-customer': {'envs': {}},
    'atg-customer-rc': {'envs': {}},
    'sanity-rc': {
        'envs': {
            'TUTORIAL_C': {
                'coverage.branches.percentage': {'min': 0.75},
                'coverage.statements.percentage': {'min': 0.75},
                'f1_score': {'min': 0.6},
            },
            'COMMON__PUT_LEAKY_BUCKET_F32_FN': {
                'coverage.branches.percentage': {'min': 0.75},
                'coverage.statements.percentage': {'min': 0.75},
                'f1_score': {'min': 0.6},
            },
            'SRC__MODMGR4A': {
                'coverage.branches.percentage': {'min': 0.75},
                'coverage.statements.percentage': {'min': 0.75},
                'f1_score': {'min': 0.6},
            },
        }
    },
}


def _extract_result(key: str, results: dict):
    keys = key.split('.')
    r = results
    try:
        for k in keys:
            r = r[k]
        return r
    except KeyError:
        return None


def check_results(run_results_path):
    errors = []

    run_results_path = Path(run_results_path)
    env_set_name = os.getenv('ENV_SET_NAME')
    envs_to_skip = os.getenv('ENVS_TO_SKIP')
    envs_to_test = os.getenv('ENVS_TO_TEST')

    if envs_to_skip:
        envs_to_skip = set(env.strip() for env in envs_to_skip.split(','))

    if envs_to_test:
        envs_to_test = set(env.strip() for env in envs_to_test.split(','))

    if not run_results_path.is_dir():
        errors.append(f'Directory {run_results_path} not found.')
        return errors

    if env_set_name not in assertions:
        errors.append(f'Environment set {env_set_name} not found.')
        return errors

    this_env_set_assertions = assertions[env_set_name]
    for env_name, metrics in this_env_set_assertions['envs'].items():
        if env_name in envs_to_skip:
            continue

        if envs_to_test and env_name not in envs_to_test:
            continue

        json_file = run_results_path / f'{env_name}_result.json'
        if not json_file.is_file():
            errors.append(f'{env_name} - JSON file {json_file} not found.')
            continue
        with open(json_file, 'r') as f:
            results = json.load(f)

        for metric, requirement in metrics.items():
            actual = _extract_result(metric, results)
            if actual is None:
                errors.append(f'{env_name} - Metric {metric} not found in results.')
                continue
            if 'min' in requirement:
                expected = requirement['min']
                if actual < expected:
                    errors.append(
                        f'{env_name} - Metric {metric} is below the minimum requirement of {expected} ({actual}).'
                    )
            elif 'max' in requirement:
                expected = requirement['max']
                if actual > expected:
                    errors.append(
                        f'{env_name} - Metric {metric} is above the maximum requirement of {expected} ({actual}).'
                    )
            else:
                raise ValueError("Requirement must have either 'min' or 'max' key.")

    return errors


def main(run_results_path):
    try:
        errors = check_results(run_results_path)
        if not errors:
            print('All requirements met.')
        else:
            with open('requirements_check_errors.txt', 'w') as f:
                for error in errors:
                    f.write(error + '\n')
    except Exception as e:
        print(f'Requirement check failed: {e}')
        sys.exit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='GHA run evaluation')
    parser.add_argument(
        'run_results_path', help='Path to the VectorCAST environment directory.'
    )

    args = parser.parse_args()
    main(args.run_results_path)
