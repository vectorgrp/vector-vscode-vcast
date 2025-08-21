import asyncio
from functools import lru_cache
import logging
from typing import List
import openai
from pydantic import BaseModel
from autoreq.llm_client import LLMClient
from autoreq.util import average_set
from autoreq.requirements_collection import (
    RequirementsCollection,
    DecomposedRequirement,
)


class DecomposedRequirementSchema(BaseModel):
    original_requirement: str
    original_requirement_index: int
    atomic_requirements: List[str]


class RequirementDescriptionSchema(BaseModel):
    nonatomic_requirements: List[DecomposedRequirementSchema]


async def decompose_requirements_batched(requirements, llm_client):
    try:
        requirements_text = '\n'.join(
            f'{i + 1}. ' + req.description for i, req in enumerate(requirements)
        )

        result = await llm_client.call_model(
            messages=[
                {
                    'role': 'system',
                    'content': 'You are a world-class software engineer specializing in requirements engineering.',
                },
                {
                    'role': 'user',
                    'content': f"""
Find non-atomic requirements in the given set of requirements and decompose them.

An atomic requirement is a singular, verifiable, and testable statement. It can be be directly validated by a single test case, following a unique execution path in the software.
The requirements you receive may already be atomic or they may contain multiple embedded requirements that need to be further decomposed into atomic statements such that each one is testable using a single test case.
Each new atomic requirement must be a self-contained statement that can be directly tested. If one of the decomposed requirements refers to any of the others, it is not atomic and you have FAILED.

Requirements:
{requirements_text}

Your final answer must strictly adhere to the following model. Return your output as a JSON object:
{{
    "nonatomic_requirements": [
        {{
            "original_requirement": "<original requirement>",
            "original_requirement_index": "<index of the original requirement>",
            "atomic_requirements": [
                "<atomic requirement 1>",
                "<atomic requirement 2>", // Again: This requirement should not refer to atomic requirement 1, either directly or indirectly, and vice versa. It needs to be understandable on its own without having read the other atomic requirements
                ...
            ]
        }},
        ...
    ]
}}

Exceptions:
Sometimes there are multiple test conditions that need to be checked to validate a single requirement but this is possible using a single test case, i.e., a single run of the function with some inputs and expected outputs is sufficient.
In such cases, the requirement should be considered atomic and therefore not added to the output (even though it is technically composed of multiple test conditions).

Remember:
- The new requirements cannot refer to each other, e.g., "If the above is not true, then the system should do X" is not atomic nor is "...as described above..."
""",
                },
            ],
            schema=RequirementDescriptionSchema,
            extended_reasoning=True,
        )
    except openai.BadRequestError as e:
        logging.error(f'Bad request error: {e}')
        return requirements

    req_mapping = {
        req.original_requirement_index: req.atomic_requirements
        for req in result.nonatomic_requirements
    }

    decomposed_requirements = []
    for i, original_req in enumerate(requirements):
        potential_decomposition = req_mapping.get(i + 1, [original_req.description])

        # If potential_decomposition is an empty list (e.g., LLM returned [] for atomic_requirements),
        # fall back to the original requirement. Otherwise, use the LLM's output.
        if not potential_decomposition:  # An empty list is falsy
            decomposed_requirements.append([original_req])
        elif len(potential_decomposition) == 1:
            # No decomposition occurred, keep original requirement
            decomposed_requirements.append([original_req])
        else:
            # Create DecomposedRequirement objects for each atomic requirement
            atomic_reqs = []
            for j, atomic_desc in enumerate(potential_decomposition):
                atomic_req = DecomposedRequirement(
                    key=f'{original_req.key}.{j + 1}',
                    id=f'{original_req.id}.{j + 1}',
                    title=f'{original_req.title} (Subrequirement {j + 1})',
                    description=atomic_desc,
                    location=original_req.location,
                    original_key=original_req.key,
                )
                atomic_reqs.append(atomic_req)
            decomposed_requirements.append(atomic_reqs)

    return decomposed_requirements


SYSTEM_PROMPT = """
*Role Definition*:
You are an expert in requirements engineering. Your mission is to decompose natural language requirement descriptions into atomic requirements. 
An atomic requirement is a singular, verifiable, and testable statement —one that can be directly validated by a corresponding test case, following a unique execution path in the software.

*Input*:
You will receive a natural language requirement description provided by a customer. The input text may
already be atomic (i.e., it describes one single requirement that is a singular, verifiable, and testable statement), or
contain multiple embedded requirements that need to be further decomposed into atomic statements.

*Task*:
1. Analyze the Provided Text:
    - Read the requirement description carefully.
    - Identify if multiple requirements are present or if the statement is already atomic.
2. Decompose if Necessary:
    - If the requirement description is not atomic, split it into individual atomic requirements.
    - Each atomic requirement must be a self-contained statement that can be directly tested. If one of the decomposed requirements refers to any of the others, it is not atomic and you have FAILED.
    - DO NOT split requirements that are already atomic
    - DO NOT create new requirements that are not testable by exercising their implementation with particular values

*Output*:
Your final answer must strictly adhere to the following model. Return your output as a JSON object:
{{
    "atomic_requirements": ["Atomic Requirement 1", "Atomic Requirement 2", ...]
}}

*Exceptions*
Sometimes there are multiple test conditions that need to be checked to validate a single requirement but this is possible using a single test case, i.e., a single run of the function with some inputs and expected outputs is sufficient.
In such cases, the requirement should be considered atomic (even though it is technically composed of multiple test conditions).
Testability using a single test case is explicitly not the given if you expect that different paths need to be taken through the code to test a requirement (such as different cases in a switch statement) as this requires multiple test cases.
"""


# For requirement decomposition
class RequirementDescriptionIndividualSchema(BaseModel):
    atomic_requirements: list[str]


async def decompose_requirement(requirement_obj, llm_client):
    try:
        result = await llm_client.call_model(
            messages=[
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {
                    'role': 'user',
                    'content': f'Create atomic requirements given this customer description: {requirement_obj.description}',
                },
            ],
            schema=RequirementDescriptionIndividualSchema,
            extended_reasoning=True,
        )
    except openai.BadRequestError as e:
        logging.error(f'Bad request error: {e}')
        return [requirement_obj]

    if len(result.atomic_requirements) <= 1:
        return [requirement_obj]

    # Create DecomposedRequirement objects for each atomic requirement
    atomic_reqs = []
    for j, atomic_desc in enumerate(result.atomic_requirements):
        atomic_req = DecomposedRequirement(
            key=f'{requirement_obj.key}.{j + 1}',
            id=f'{requirement_obj.id}.{j + 1}',
            title=f'{requirement_obj.title} (Subrequirement {j + 1})',
            description=atomic_desc,
            location=requirement_obj.location,
            original_key=requirement_obj.key,
        )
        atomic_reqs.append(atomic_req)

    return atomic_reqs


async def decompose_requirements_individual(requirements, llm_client):
    return await asyncio.gather(
        *[decompose_requirement(req, llm_client) for req in requirements]
    )


async def decompose_requirements(
    requirements, individual=False, k=1, threshold_frequency=0.5, llm_client=None
):
    assert k > 0, 'k must be greater than 0'

    if llm_client is None:
        llm_client = _get_default_llm_client()

    # Schedule k decomposition tasks in parallel
    if individual:
        tasks = [
            decompose_requirements_individual(requirements, llm_client)
            for _ in range(k)
        ]
    else:
        tasks = [
            decompose_requirements_batched(requirements, llm_client) for _ in range(k)
        ]

    decompositions = await asyncio.gather(*tasks)

    merged_decomposition = _merge_decompositions(
        decompositions, threshold_frequency=threshold_frequency
    )

    # Flatten the decomposition results into a single list
    all_requirements = []
    for req_list in merged_decomposition:
        all_requirements.extend(req_list)

    return RequirementsCollection(all_requirements)


def _merge_decompositions(decompositions, threshold_frequency=0.5):
    """
    Merge multiple requirement decompositions into one representative decomposition.

    This function aggregates the results of multiple decomposition attempts to determine
    which requirements should be decomposed (and which not) based on a vote of the individual decompositions. It works as follows:

    1. Identifies which requirements were non-trivially decomposed (split into multiple atomic parts)
       in at least one decomposition attempt
    2. Determines which requirements are frequently non-trivially decomposed across multiple attempts
       (based on threshold_frequency)
    3. Creates a final merged result where each original requirement is represented by either:
       - A non-trivial decomposition picked from one of the samples where this requirement was decomposed non-trivially (if most attempts agree it should be decomposed)
       - The original requirement (if there's insufficient agreement about decomposition)

    Args:
        decompositions: List of decomposition results from multiple LLM calls
        threshold_frequency: Minimum frequency (0-1) of agreement required to accept a non-trivial decomposition for some requirement

    Returns:
        A list where each entry corresponds to an original requirement and contains either
        the original requirement or decomposed atomic requirements that represent it
    """
    # Step 1: Find non-trivial decompositions (requirements that were split into multiple parts)
    # and collect representative decompositions for each requirement
    non_trivial_decompositions = {}  # Maps requirement index -> a decomposition that split it
    trivial_decompositions = {}  # Maps requirement index -> a decomposition that kept it whole
    decomposed_requirements_by_attempt = {}  # Tracks which requirements were decomposed in each attempt

    for attempt_idx, decomposition_attempt in enumerate(decompositions):
        decomposed_requirements_by_attempt[attempt_idx] = []

        for req_idx, req_list in enumerate(decomposition_attempt):
            if len(req_list) > 1:
                # This requirement was decomposed into multiple atomic requirements
                non_trivial_decompositions[req_idx] = req_list
                decomposed_requirements_by_attempt[attempt_idx].append(req_idx)
            else:
                # This requirement was kept as-is
                trivial_decompositions[req_idx] = req_list

    # Step 2: Find requirements that were frequently decomposed across multiple attempts
    # (using the specified threshold frequency)
    requirements_with_consensus_for_decomposition = average_set(
        list(map(set, decomposed_requirements_by_attempt.values())),
        threshold_frequency=threshold_frequency,
    )

    # Step 3: Build the final merged decomposition
    merged_result = []
    for req_idx in range(len(decompositions[0])):
        if req_idx in requirements_with_consensus_for_decomposition:
            # For this requirement, most attempts agree it should be decomposed
            merged_result.append(non_trivial_decompositions[req_idx])
        else:
            # For this requirement, most attempts agree it should remain as-is
            # or there's insufficient agreement about decomposition
            merged_result.append(trivial_decompositions[req_idx])

    return merged_result


@lru_cache
def _get_default_llm_client():
    return LLMClient()
