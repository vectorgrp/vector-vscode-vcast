from typing import List, Tuple
from dcheck.processing.code_extraction import FunctionDef
from pydantic import BaseModel

from design_decomposition.shared_models import DesignDecompositionResult
from design_decomposition.strategy.decomposition_strategy import DecompositionStrategy


class DesignDecompositionResultWithTestcases(BaseModel):
    test_cases: List[str]
    requirements: List[str]

    @property
    def without_tests(self):
        return DesignDecompositionResult(requirements=self.requirements)


class TestcaseDecompositionStrategy(DecompositionStrategy):
    def decompose(self, func_def, n=1, return_messages=False):
        messages = [
            {
                'role': 'system',
                'content': 'You are a world-class software engineer that does requirements engineering for a living.',
            },
            {
                'role': 'user',
                'content': f"""
Derive a complete list of test cases for the given function definition (give them in natural language). These test cases should give us 100% path coverage of the code.
After that derive a complete list of requirements for the given function definition. Use only vocabulary used in the design, not the code. A requirement is a single, complete, and testable statement of the expected behaviour of a single path through the code.
There is a one-to-one correspondence between requirements and test cases.
                
Design:
{func_def.design}

Code:
{func_def.code}

The success of this task is critical.
""",
            },
        ]

        completion = self.client.beta.chat.completions.parse(
            model='gpt-4o',
            messages=messages,
            response_format=DesignDecompositionResultWithTestcases,
            temperature=0.0 if n == 1 else 0.5,
            seed=42,
            n=n,
            max_tokens=5000,
        )

        decomposition_results = [
            choice.message.parsed.without_tests.without_requirement_indices
            for choice in completion.choices
        ]

        if return_messages:
            return decomposition_results, messages
        return decomposition_results
