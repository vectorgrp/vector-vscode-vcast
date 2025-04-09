
import asyncio
import logging
from typing import List, Union
import openai
from pydantic import BaseModel, create_model
from autoreq.llm_client import LLMClient


class DecomposedRequirement(BaseModel):
    original_requirement: str
    original_requirement_index: int
    atomic_requirements: List[str]

class RequirementDescription(BaseModel):
    nonatomic_requirements: List[DecomposedRequirement]

async def decompose_requirements(requirements, llm_client=LLMClient()):
    try:
        requirements_text = "\n".join(f"{i+1}. " + r for i, r in enumerate(requirements))

        result = await llm_client.call_model(
            messages=[
                {"role": "system", "content": "You are a world-class software engineer specializing in requirements engineering."},
                {"role": "user", "content": f"""
Find non-atomic requirements in the given set of requirements and decompose them.

An atomic requirement is a singular, verifiable, and testable statement. It can be be directly validated by a single test case, following a unique execution path in the software.
The requirements you receive may already be atomic or they may contain multiple embedded requirements that need to be further decomposed into atomic statements such that each one is testable using a single test case.

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
                "<atomic requirement 2>",
                ...
            ]
        }},
        ...
    ]
}}

Exceptions:
Sometimes there are multiple test conditions that need to be checked to validate a single requirement but this is possible using a single test case, i.e., a single run of the function with some inputs and expected outputs is sufficient.
In such cases, the requirement should be considered atomic and therefore not added to the output (even though it is technically composed of multiple test conditions).
"""
                }
            ],
            schema=RequirementDescription,
            extended_reasoning=True
        )
    except openai.BadRequestError as e:
        logging.error(f"Bad request error: {e}")
        return requirements

    req_mapping = {req.original_requirement_index: req.atomic_requirements for req in result.nonatomic_requirements}

    decomposed_requirements = []
    for i, unprocessed_requirement in enumerate(requirements):
        decomposed_requirements.append(
            req_mapping.get(i+1, [unprocessed_requirement])
        )


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
    - Each atomic requirement must be a self-contained statement that can be directly tested.
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

"""
# For requirement decomposition
class RequirementDescription(BaseModel):
    atomic_requirements: list[str]

async def decompose_requirement(requirement, llm_client=LLMClient()):
    try:
        result = await llm_client.call_model(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": f"Create atomic requirements given this customer description: {requirement}",
                },
            ],
            schema=RequirementDescription,
            extended_reasoning=True
        )
    except openai.BadRequestError as e:
        logging.error(f"Bad request error: {e}")
        return [requirement]

    if len(result.atomic_requirements) <= 1:
        return [requirement]

    return result.atomic_requirements

async def decompose_requirements(requirements, llm_client=LLMClient()):
    return await asyncio.gather(
        *[decompose_requirement(req, llm_client) for req in requirements]
    )
"""