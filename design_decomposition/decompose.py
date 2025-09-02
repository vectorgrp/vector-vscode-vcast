from typing import List
from pydantic import BaseModel
from enum import Enum

from design_decomposition.shared_models import DesignDecompositionResult
from design_decomposition.strategy.characteristic import (
    CharacteristicDecompositionStrategy,
)
from design_decomposition.strategy.paths import PathsDecompositionStrategy
from design_decomposition.strategy.pseudocode import PseudocodeDecompositionStrategy
from design_decomposition.strategy.simple import SimpleDecompositionStrategy
from design_decomposition.strategy.tests import TestcaseDecompositionStrategy


class ErrorCorrectionFeedback(BaseModel):
    problems: List[str]


class DecompositionStrategy(Enum):
    SIMPLE = "simple"
    ANDREW = "andrew"
    PSEUDOCODE = "pseudocode"
    TEST_CASES = "test_cases"
    PATHS = "paths"


class DesignDecomposer:
    def __init__(self):
        import openai
        import os

        self.client = openai.AzureOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            api_version="2024-08-01-preview",
            azure_endpoint=os.getenv("OPENAI_API_BASE"),
            azure_deployment=os.getenv("OPENAI_GENERATION_DEPLOYMENT"),
        )

    def decompose_design(
        self, func_def, strategy=DecompositionStrategy.TEST_CASES, n=1, corrections=0
    ):
        if strategy == DecompositionStrategy.SIMPLE:
            strategy = SimpleDecompositionStrategy(self.client)
        elif strategy == DecompositionStrategy.ANDREW:
            strategy = CharacteristicDecompositionStrategy(self.client)
        elif strategy == DecompositionStrategy.PSEUDOCODE:
            strategy = PseudocodeDecompositionStrategy(self.client)
        elif strategy == DecompositionStrategy.TEST_CASES:
            strategy = TestcaseDecompositionStrategy(self.client)
        elif strategy == DecompositionStrategy.PATHS:
            strategy = PathsDecompositionStrategy(self.client)

        decomposition_results, messages = strategy.decompose(
            func_def, n=n, return_messages=True
        )

        # Move aggregation and error correction steps outside the strategies
        if n > 1:
            decomposition_result = self._combine_requirements(
                func_def, decomposition_results
            )
        else:
            decomposition_result = decomposition_results[0]

        decomposition_result = self._error_correction(
            func_def, decomposition_result, messages, corrections
        )

        return decomposition_result

    def _combine_requirements(self, func_def, decomposition_results):
        messages = [
            {
                "role": "system",
                "content": "You are a world-class software engineer specializing in requirements engineering.",
            },
            {
                "role": "user",
                "content": f"""
Combine multiple sets of requirements for the same function. A requirement is a single, complete, independent and testable statement of the expected behaviour of a single path through the code. It should only use vocabulary mentioned in the design, not the code. 
Choose the best aspects of each design, e.g., where they follow the definitions of a requirement most closely and cleverly merge them to address any problems the individual sets might have.

Design:
{func_def.design}

Code:
{func_def.code}

Requirements sets:
{chr(10).join([result.model_dump_json(indent=4) for result in decomposition_results])}

The success of this task is critical. The purpose is to derive unit tests, exactly one per requirement, that will test the behaviour of the exact code path described in the final requirements.
""",
            },
        ]

        with open("combine_requirements_messages.txt", "w") as f:
            for message in messages:
                f.write(f'{message["role"]}: {message["content"]}\n\n')

        completion = self.client.beta.chat.completions.parse(
            model="gpt-4o",
            messages=messages,
            response_format=DesignDecompositionResult,
            temperature=0.0,
            seed=42,
            max_tokens=5000,
        )

        return completion.choices[0].message.parsed

    def _error_correction(
        self, func_def, decomposition_result, messages, max_corrections
    ):
        iteration = 0
        error_correction_history = []
        while iteration < max_corrections:
            iteration += 1

            # Find problems using the new method
            problems = self._find_problems(
                func_def, decomposition_result, history=error_correction_history
            )

            if not problems:
                break  # No problems found

            # Prepare feedback messages
            feedback_messages = messages + [
                {
                    "role": "assistant",
                    "content": decomposition_result.model_dump_json(indent=4),
                },
                {
                    "role": "user",
                    "content": f"""
The following issues were found with the requirements:

{chr(10).join(f'- {problem}' for problem in problems)}

Please revise the requirements to address these problems. If you encountered a similar problem before and it comes up again try a different way to address it.
""",
                },
            ]

            with open("feedback_messages.txt", "w") as f:
                for message in feedback_messages:
                    f.write(f'{message["role"]}: {message["content"]}\n\n')

            # Get revised requirements from the language model
            completion = self.client.beta.chat.completions.parse(
                model="gpt-4o",
                messages=feedback_messages,
                response_format=DesignDecompositionResult,
                temperature=0.0,
                seed=42,
                max_tokens=5000,
            )

            decomposition_result = completion.choices[0].message.parsed

            # Update messages for the next iteration
            messages = feedback_messages

        return decomposition_result.without_requirement_indices

    def _find_problems(self, func_def, decomposition_result, history=[]):
        problem_finding_messages = [
            {
                "role": "system",
                "content": "You are a world-class software engineer specializing in requirements engineering.",
            },
            {
                "role": "user",
                "content": f"""
Given a list of low-level functional requirements based on the given design, identify any issues that may be present.
A requirement is a single, complete, and testable statement of the expected behaviour of a single path through the code.

Potential issues:
- Requirements should not mention variables or elements defined only in the code and not described in the design. Do any requirements reference code-specific elements not present in the design?
- The requirements together should describe everything in the original design. Are any parts of the design not covered by the requirements?
- The requirements together should only describe what is in the original design. Are there any requirements that cover more than the design specifies?
- A requirement should describe only one behavior. Do any requirements describe more than one behavior?
- Each requirement should be independently understandable. Do any requirements refer to or depend on other requirements?

Design:
{func_def.design}

Code:
{func_def.code}

Carefully look at everything and list any issues you find. Your task is like being a linter but for requirements.
Do not invent problems if no serious ones exist. If you do it anyways you have failed your task.
""",
            },
            *[history_item for history_item in history],
            {"role": "user", "content": decomposition_result.model_dump_json(indent=4)},
        ]

        with open("problem_finding_messages.txt", "w") as f:
            for message in problem_finding_messages:
                f.write(f'{message["role"]}: {message["content"]}\n\n')

        # Call the LLM to find problems
        completion = self.client.beta.chat.completions.parse(
            model="gpt-4o",
            messages=problem_finding_messages,
            response_format=ErrorCorrectionFeedback,
            temperature=0.0,
            seed=42,
            max_tokens=1000,
        )

        history.append(
            {"role": "user", "content": decomposition_result.model_dump_json(indent=4)}
        )

        history.append(
            {
                "role": "assistant",
                "content": completion.choices[0].message.parsed.model_dump_json(
                    indent=4
                ),
            }
        )

        return completion.choices[0].message.parsed.problems
