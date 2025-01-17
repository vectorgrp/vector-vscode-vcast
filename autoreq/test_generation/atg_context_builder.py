from typing import List, Dict, Optional
from pydantic import BaseModel
import asyncio
import random
import json
from ..llm_client import LLMClient

class PathSelection(BaseModel):
    analysis: str
    selected_path: int

class ATGContextBuilder:
    def __init__(self, environment):
        self.environment = environment
        self.cache = {}
        self.locks = {}
        self._test_cases = None
        random.seed(42)  # Fixed seed for reproducibility

    async def get_relevant_test_cases(self, function_name: str, k: int = 3, basis_path=False) -> str:
        if function_name in self.cache:
            return self.cache[function_name]

        if function_name not in self.locks:
            self.locks[function_name] = asyncio.Lock()

        async with self.locks[function_name]:
            if function_name in self.cache:
                return self.cache[function_name]

            # Initialize test cases if not done yet
            if self._test_cases is None:
                if basis_path:
                    self._test_cases = self.environment.basis_path_tests
                else:
                    self._test_cases = self.environment.atg_tests
                if not self._test_cases:
                    return ""

            # Filter test cases by function name prefix and convert to dict
            matching_tests = [
                test.to_dict() for test in self._test_cases 
                if test.subprogram_name.startswith(function_name)
            ]

            # Select up to k random tests
            selected_tests = random.sample(matching_tests, min(k, len(matching_tests))) if matching_tests else []
            formatted_tests = json.dumps(selected_tests, indent=2)

            self.cache[function_name] = formatted_tests
            return formatted_tests

    def cleanup(self):
        self.cache.clear()
        self.locks.clear()
        self._test_cases = None
