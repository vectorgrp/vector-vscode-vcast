from typing import List
from pydantic import BaseModel

from design_decomposition.shared_models import DesignDecompositionResult
from design_decomposition.strategy.decomposition_strategy import DecompositionStrategy


class DesignDecompositionResultWithPaths(BaseModel):
    code_paths: List[str]
    designed_code_paths: List[str]
    requirements: List[str]

    @property
    def without_paths(self):
        return DesignDecompositionResult(requirements=self.requirements)


class PathsDecompositionStrategy(DecompositionStrategy):
    def decompose(self, func_def, n=1, return_messages=False):
        messages = [
            {
                'role': 'system',
                'content': 'You are a world-class software engineer that does requirements engineering for a living.',
            },
            {
                'role': 'user',
                'content': f"""
Derive a complete list of requirements for the given function definition. Use only vocabulary used in the design, not the code. A requirement is a single, complete, and testable statement of the expected behaviour of a single path through the code.
                
Design:
{func_def.design}

Code:
{func_def.code}

To solve this task, first enumerate all potential paths through the code. A path is fully defined by a series of IF (both in code and the preprocessor) conditions and the decision made at each. Ignore looping constructs when deriving the paths.
Then enumerate all paths you just derived and only keep those who have been explicitly designed.
For each such path, derive the expected behaviour of the code path. This behaviour should be a single, complete, and testable statement. It has to be understandable independent of other requirements or the code.

The success of this task is critical. The purpose is to derive unit tests, exactly one per requirement, that will test the behaviour of the exact code path described in the final requirements_text.
""",
            },
        ]

        completion = self.client.beta.chat.completions.parse(
            model='gpt-4o',
            messages=messages,
            response_format=DesignDecompositionResultWithPaths,
            temperature=0.0 if n == 1 else 0.5,
            seed=42,
            n=n,
            max_tokens=5000,
        )

        print(completion.choices[0].message.parsed)

        decomposition_results = [
            choice.message.parsed.without_paths.without_requirement_indices
            for choice in completion.choices
        ]

        if return_messages:
            return decomposition_results, messages
        return decomposition_results
