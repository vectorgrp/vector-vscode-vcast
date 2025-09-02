"""
Requirements to Code Mapper

This module provides functionality to map requirements to source code functions using semantic similarity.
The mapper focuses on a single VectorCAST environment and works with RequirementsCollection objects.

Key features:
- Single environment focus: Constructor takes an environment path
- Requirements Collection API: Input and output are RequirementsCollection objects
- Location enhancement: Adds function location information to requirements
- Semantic matching: Uses LLM to find best function matches for requirements

Example usage:
    mapper = Reqs2CodeMapper("/path/to/vectorcast/env")
    output_collection = await mapper.map_requirements_to_code(input_collection)
"""

import logging
from async_lru import alru_cache
from autoreq.requirement_generation.generation import RequirementsGenerator
from autoreq.requirements_collection import (
    RequirementsCollection,
    Requirement,
)
from pydantic import BaseModel
import asyncio
from autoreq.llm_client import LLMClient


class CorrespondingFunction(BaseModel):
    reasoning: str
    corresponding_function: str


class Reqs2CodeMapper:
    def __init__(self, environment):
        self.environment = environment
        self.llm_client = LLMClient()

    @alru_cache
    async def _generate_requirements_for_env(self):
        req_generator = RequirementsGenerator(
            self.environment,
            combine_related_requirements=False,
            extended_reasoning=False,
        )

        tasks = [
            req_generator.generate(
                function_name=func['name'], post_process_requirements=False
            )
            for func in self.environment.testable_functions
        ]
        results = await asyncio.gather(*tasks)
        generated_reqs = RequirementsCollection(
            [req for result in results for req in result]
        )

        return generated_reqs

    async def _generate_rendered_requirements_mapping(self):
        """Generate a mapping of synthetic requirements to functions."""
        generated_reqs = await self._generate_requirements_for_env()
        mapping = {req.description: req.location.function for req in generated_reqs}
        return mapping

    async def _process_requirement(self, requirement: Requirement):
        """Process a single requirement to find its corresponding function."""
        system_prompt = """You are a helpful assistant and an expert in requirements engineering and semantic similarity"""

        task_prompt = f"""Given a low-level atomic requirement "{requirement.description}", you need to determine which function is it most likely to be coming from. You will be given a mapping between low-level requirements and function names.
        Here is the mapping:
        {await self._generate_rendered_requirements_mapping()} 
        This task is critical, make sure to give the best possible answer.
        Format your output according to the following pydantic model
        class CorrespondingFunction(BaseModel):
            reasoning: str
            corresponding_function: str
        """

        # cropping input to approx. 14k tokens
        # rough estimate, as Patrick had some issues with tiktoken and pyinstaller

        estimated_num_tokens = len(task_prompt) // 4
        max_num_tokens = 14000
        if estimated_num_tokens > max_num_tokens:
            final_instruction_text = """ This task is critical, make sure to give the best possible answer.
        Format your output according to the following pydantic model
        class CorrespondingFunction(BaseModel):
            reasoning: str
            corresponding_function: str
        """
            task_prompt = task_prompt[: max_num_tokens * 4] + final_instruction_text

        try:
            message = await self.llm_client.call_model(
                messages=[
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': task_prompt},
                ],
                schema=CorrespondingFunction,
                temperature=0,
                max_completion_tokens=5000,
            )
            if message:
                corresponding_function = getattr(
                    message, 'corresponding_function', None
                )
                if corresponding_function is None:
                    raise ValueError('No corresponding_function in response')
            else:
                raise ValueError('No response from LLM')
        except Exception as e:
            logging.error(f'Error processing requirement {requirement.key}: {e}')
            corresponding_function = None

        return (requirement, corresponding_function)

    async def _process_all_requirements(
        self, requirements_collection: RequirementsCollection
    ):
        async_tasks = []
        for requirement in requirements_collection:
            async_tasks.append(self._process_requirement(requirement))

        req_func_pairs = await asyncio.gather(*async_tasks)
        return req_func_pairs

    async def map_requirements_to_code(
        self, requirements_collection: RequirementsCollection
    ) -> RequirementsCollection:
        # Process all requirements to find their corresponding functions
        req_func_pairs = await self._process_all_requirements(requirements_collection)

        # Create new requirements with location information
        updated_requirements = []
        for requirement, corresponding_function in req_func_pairs:
            # Create a copy of the requirement with location information
            new_requirement = requirement.model_copy(deep=True)
            new_requirement.location.function = corresponding_function  # Update only the function for now, this can be extended later
            new_requirement.location.lines = (
                None  # The mapping might be imprecise, leave this empty for now
            )
            # TODO: We expect that the unit already exists on the old requirement

            updated_requirements.append(new_requirement)

        return RequirementsCollection(updated_requirements)
