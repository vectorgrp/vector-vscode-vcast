import json
import argparse
from sys import exit
from vector.apps.DataAPI.unit_test_api import UnitTestApi


def get_test_case_by_id(env_path, test_case_id):
    with UnitTestApi(env_path + '.vce') as api:
        # Get all test cases
        test_cases = api.TestCase.all()
        # Find the test case with the given name
        for test_case in test_cases:
            test_id = (
                test_case.unit_display_name
                + '.'
                + test_case.function_display_name
                + '.'
                + test_case.name
            )
            if test_id.lower() == test_case_id.lower():
                return test_case

    return None


def get_individual_coverage_info(test):
    # Get the coverage data
    coverage_data = test.cover_data

    if not coverage_data:
        raise ValueError(f"Coverage data not available for test case '{test.name}'.")

    # Get the number of statements and branches
    num_statements = coverage_data.metrics.statements
    num_branches = coverage_data.metrics.branches

    # Get the covered statements and branches
    covered_statements = coverage_data.covered_statements
    covered_true_branches = coverage_data.covered_true_branches
    covered_false_branches = coverage_data.covered_false_branches

    covered_statements_indices = set(s.lis_index for s in covered_statements)
    covered_true_branches_indices = set(b.lis_index for b in covered_true_branches)
    covered_false_branches_indices = set(b.lis_index for b in covered_false_branches)

    covered_statements = set(s.lis_source for s in covered_statements)
    covered_true_branches = set(b.lis_source for b in covered_true_branches)
    covered_false_branches = set(b.lis_source for b in covered_false_branches)

    return {
        'num_statements': num_statements,
        'covered_statement_indices': list(covered_statements_indices),
        'covered_statements': list(covered_statements),
        'num_branches': num_branches,
        'covered_true_branches_indices': list(covered_true_branches_indices),
        'covered_false_branches_indices': list(covered_false_branches_indices),
        'covered_true_branches': list(covered_true_branches),
        'covered_false_branches': list(covered_false_branches),
    }


def get_aggregate_coverage_info(test_cases):
    covered_statements = set()
    covered_true_branches = set()
    covered_false_branches = set()
    num_total_statements = 0
    num_total_branches = 0

    for test in test_cases:
        test_coverage_data = get_individual_coverage_info(test)

        num_total_statements = test_coverage_data['num_statements']
        num_total_branches = test_coverage_data['num_branches']

        covered_statements |= set(
            map(tuple, test_coverage_data['covered_statement_indices'])
        )
        covered_true_branches |= set(
            map(tuple, test_coverage_data['covered_true_branches_indices'])
        )
        covered_false_branches |= set(
            map(tuple, test_coverage_data['covered_false_branches_indices'])
        )

    num_covered_statements = len(covered_statements)
    num_covered_branches = len(covered_true_branches) + len(covered_false_branches)

    coverage_data = {
        'statements': {
            'covered': num_covered_statements,
            'total': num_total_statements,
            'percentage': (num_covered_statements / num_total_statements)
            if num_total_statements > 0
            else 0,
        },
        'branches': {
            'covered': num_covered_branches,
            'total': num_total_branches,
            'percentage': (num_covered_branches / num_total_branches)
            if num_total_branches > 0
            else 0,
        },
    }

    return coverage_data


def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Get test coverage information.')
    parser.add_argument('env_path', help='Path to the env.')
    parser.add_argument(
        'test_case_ids',
        nargs='+',
        help='ID (unit.suprogram.test_name) of the test cases.',
    )
    args = parser.parse_args()

    # Get the test cases
    test_cases = []
    for test_case_id in args.test_case_ids:
        test_case = get_test_case_by_id(args.env_path, test_case_id)
        if test_case:
            test_cases.append(test_case)
        else:
            print(f"Test case '{test_case_id}' not found.")
            exit(1)

    coverage_info = get_aggregate_coverage_info(test_cases)

    print(json.dumps(coverage_info, indent=4))


main()
