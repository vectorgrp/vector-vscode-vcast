import asyncio
from pydantic import BaseModel
from typing import List, Optional, Literal

from ..llm_client import LLMClient
from ..test_generation.vcast_context_builder import VcastContextBuilder
from ..test_generation.info_logger import InfoLogger


class EvaluationResult(BaseModel):
    grade: int


class RequirementEvaluationResult(BaseModel):
    function_name: str
    score: float


class RequirementsVerifier:
    """Verifies and evaluates requirements against code or ground truth requirements."""

    def __init__(self, environment):
        self.environment = environment
        self.llm_client = LLMClient()
        self.info_logger = InfoLogger()
        self.context_builder = VcastContextBuilder(environment)

    async def evaluate_requirements(
        self,
        function_name: str,
        requirements: List[str],
        mode: Literal["exhaustiveness", "gt_similarity"] = "exhaustiveness",
        ground_truth: Optional[List[str]] = None,
    ) -> RequirementEvaluationResult:
        if mode == "gt_similarity" and not ground_truth:
            raise ValueError(
                "Ground truth requirements must be provided for similarity comparison."
            )

        requirements_text = "\n".join("- " + r for r in requirements)

        if mode == "exhaustiveness":
            # Build code context
            code = await self.context_builder.build_code_context(function_name)

            messages = [
                {
                    "role": "system",
                    "content": "You are a world-class software engineer specializing in requirements engineering.",
                },
                {
                    "role": "user",
                    "content": f"""
Assess how exhaustively the provided requirements describe the given code. Return a grade between 0 and 10, where 10 means the requirements fully describe all paths through the code, and 0 means they describe nothing at all.

Code:
{code}

Requirements:
{requirements_text}
""",
                },
            ]

        elif mode == "gt_similarity":
            ground_truth_text = "\n".join("- " + r for r in ground_truth)

            messages = [
                {
                    "role": "system",
                    "content": "You are a world-class software engineer specializing in requirements engineering.",
                },
                {
                    "role": "user",
                    "content": f"""
Compare the following two sets of requirements and determine if all behaviors described in Set 1 are present in Set 2. Return a grade between 0 and 10 indicating the degree to which Set 1 is a subset of Set 2, where 10 means Set 1 is completely a subset of Set 2 and 0 means there is no overlap.

Set 1:
{ground_truth_text}

Set 2:
{requirements_text}
""",
                },
            ]
        else:
            raise ValueError(f"Invalid evaluation mode: {mode}")

        result = await self.llm_client.call_model(
            messages,
            EvaluationResult,
            temperature=0.0,
            max_tokens=1000,
            extended_reasoning=True,
        )

        score = result.grade
        score = max(0, min(score, 10))  # Ensure score is between 0 and 10
        normalized_score = score / 10

        return RequirementEvaluationResult(
            function_name=function_name,
            score=normalized_score,
        )

    async def evaluate_requirements_batch(
        self,
        function_names: List[str],
        requirements: List[List[str]],
        mode: Literal["exhaustiveness", "gt_similarity"] = "exhaustiveness",
        ground_truth: List[List[str]] = None,
    ) -> List[RequirementEvaluationResult]:
        tasks = []

        if ground_truth is None:
            ground_truth = [None] * len(function_names)

        for function_name, reqs, ground_truth_reqs in zip(
            function_names, requirements, ground_truth
        ):
            tasks.append(
                self.evaluate_requirements(function_name, reqs, mode, ground_truth_reqs)
            )

        return await asyncio.gather(*tasks)
