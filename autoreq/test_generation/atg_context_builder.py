from async_lru import alru_cache
from pydantic import BaseModel
import random
import json

from ..util import sanitize_subprogram_name


class PathSelection(BaseModel):
    analysis: str
    selected_path: int


class ATGContextBuilder:
    def __init__(self, environment):
        self.environment = environment

    @alru_cache(maxsize=None)
    async def get_relevant_test_cases(
        self, function_name: str, k: int = 3, basis_path=False, seed=42
    ) -> str:
        random.seed(seed)

        test_cases = (
            self.environment.atg_tests
            if not basis_path
            else self.environment.basis_path_tests
        )

        # Filter test cases by function name prefix and convert to dict
        # Also handles overloaded subprogram names by removing the overloading+template part
        # TODO: We might just want to improve the naming of testable_functions instead
        matching_tests_nopartial = [
            test.to_dict()
            for test in test_cases
            if sanitize_subprogram_name(test.subprogram_name).endswith(function_name)
            and all(
                keyword not in test.test_name
                for keyword in ["PARTIAL", "INCOMPLETE", "TEMPLATE"]
            )
        ]

        matching_tests_partial = [
            test.to_dict()
            for test in test_cases
            if sanitize_subprogram_name(test.subprogram_name).endswith(function_name)
            and any(
                keyword in test.test_name
                for keyword in ["PARTIAL", "INCOMPLETE", "TEMPLATE"]
            )
        ]

        # Select up to k random tests
        selected_tests_optimal = (
            random.sample(
                matching_tests_nopartial, min(k, len(matching_tests_nopartial))
            )
            if matching_tests_nopartial
            else []
        )
        selected_tests_rest = (
            random.sample(
                matching_tests_partial,
                min(k - len(selected_tests_optimal), len(matching_tests_partial)),
            )
            if matching_tests_partial
            else []
        )

        selected_tests = selected_tests_optimal + selected_tests_rest

        formatted_tests = json.dumps(selected_tests, indent=2)

        return formatted_tests

    def cleanup(self):
        self.cache.clear()
        self.locks.clear()
        self._test_cases = None
