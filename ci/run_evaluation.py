import os
import json
import argparse

from pathlib import Path

assertions = {
    'sanity': {
        'envs': {
            'TUTORIAL_C': {
                'coverage.branches.percentage': {
                    'min': 1.0
                },
                'coverage.statements.percentage': {
                    'min': 1.0
                },
                'f1_score': {
                    'min': 0.75,
                }
            },
            'LEAKY_BUCKET': {
                'coverage.branches.percentage': {
                    'min': 1.0
                },
                'coverage.statements.percentage': {
                    'min': 1.0
                },
                'f1_score': {
                    'min': 0.75,
                }
            },
            'SRC__MODMGR4A': {
                'coverage.branches.percentage': {
                    'min': 1.0
                },
                'coverage.statements.percentage': {
                    'min': 1.0
                },
                'f1_score': {
                    'min': 0.5,
                }
            }
        }
    },
    'piinnovo': {
        'envs': {}
    },
    'atg-customer': {
        'envs': {}
    }
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
    global assertions
    run_results_path = Path(run_results_path)
    env_set_name = os.getenv("ENV_SET_NAME")

    if not run_results_path.is_dir():
        raise FileNotFoundError(f"Directory {run_results_path} not found.")

    if env_set_name not in assertions:
        raise ValueError(f"Environment set {env_set_name} not found.")

    this_env_set_assertions = assertions[env_set_name]
    for env_name, metrics in this_env_set_assertions['envs'].items():
        json_file = run_results_path / f"{env_name}_result.json"
        if not json_file.is_file():
            raise FileNotFoundError(f"JSON file {json_file} not found.")
        with open(json_file, 'r') as f:
            results = json.load(f)

        for metric, requirement in metrics.items():
            if 'min' in requirement:
                expected = requirement['min']
                actual = _extract_result(metric, results)
                if actual is None:
                    raise KeyError(f"Metric {metric} not found in results.")
                assert actual >= expected, f"Metric {metric} for environment {env_name} is below the minimum requirement of {expected}."
            elif 'max' in requirement:
                expected = requirement['max']
                actual = _extract_result(metric, results)
                if actual is None:
                    raise KeyError(f"Metric {metric} not found in results.")
                assert actual <= expected, f"Metric {metric} for environment {env_name} is above the maximum requirement of {expected}."
            else:
                raise ValueError("Requirement must have either 'min' or 'max' key.")


def main(run_results_path):
    try:
        check_results(run_results_path)
        print("All requirements met.")
    except Exception as e:
        print(f"Requirement check failed: {e}")
        exit(1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="GHA run evaluation")
    parser.add_argument("run_results_path", help="Path to the VectorCAST environment directory.")

    args = parser.parse_args()
    main(args.run_results_path)
