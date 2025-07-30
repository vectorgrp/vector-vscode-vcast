import logging
from typing import List, Dict, Any
from pydantic import BaseModel, create_model
import traceback

from autoreq.util import get_executable_statement_groups
from autoreq.info_logger import RequirementGenerationInfoLogger

from ..llm_client import LLMClient
from ..test_generation.vcast_context_builder import VcastContextBuilder


class DesignDecompositionResult(BaseModel):
    requirements: List[str]

    @property
    def with_requirement_indices(self):
        return DesignDecompositionResult(
            requirements=[
                f'Requirement {i + 1}: {req}'
                for i, req in enumerate(self.without_requirement_indices.requirements)
            ]
        )

    @property
    def without_requirement_indices(self):
        return DesignDecompositionResult(
            requirements=[
                req.split(':', 1)[1].strip() if ':' in req else req
                for req in self.requirements
            ]
        )


class DesignDecompositionResultWithTestcases(BaseModel):
    test_cases: List[str]
    requirements: List[str]

    @property
    def without_tests(self):
        return DesignDecompositionResult(requirements=self.requirements)


class ReworkedRequirementsResult(BaseModel):
    reworked_requirements: List[str]


def _derive_requirement_schema(num_parts):
    """Creates a dynamic schema that forces exactly one requirement per semantic part."""

    class TestCase(BaseModel):
        description: str

    class Requirement(BaseModel):
        statement: str

    # Create fields for each semantic part
    result_keys = {
        f'test_case_for_part_{i + 1}': (TestCase, ...) for i in range(num_parts)
    }
    result_keys.update(
        {f'requirement_for_part_{i + 1}': (Requirement, ...) for i in range(num_parts)}
    )

    return create_model('RequirementGenerationResult', **result_keys)


def _batch_items(items, batch_size=50):
    for i in range(0, len(items), batch_size):
        yield items[i : i + batch_size]


class RequirementsGenerator:
    def __init__(
        self,
        environment,
        code_independence: bool = False,
        combine_related_requirements: bool = False,
        extended_reasoning: bool = False,
    ):
        self.llm_client = LLMClient()
        self.environment = environment
        self.code_independence = code_independence
        self.combine_related_requirements = combine_related_requirements
        self.extended_reasoning = extended_reasoning
        self.context_builder = VcastContextBuilder(environment)
        self.info_logger = RequirementGenerationInfoLogger()

    def extract_semantic_parts(self, function_name: str) -> List[Dict[str, Any]]:
        function_body = self.environment.tu_codebase.find_definitions_by_name(
            function_name
        )[0]

        return get_executable_statement_groups(
            function_body, include_virtual_groups=True
        )

    async def _postprocess_requirements(
        self, function_name: str, requirements: List[str], allow_merge=True
    ) -> List[Dict[str, Any]]:
        function_body = self.environment.tu_codebase.find_definitions_by_name(
            function_name
        )[0]
        requirements_text = '\n'.join('- ' + r for r in requirements)

        if allow_merge:
            merge_instructions = 'You are not just allowed to split the requirements into smaller parts, but also to merge them if you think that the original requirements are too granular.'
        else:
            merge_instructions = ''

        prompt = f"""
You will be given a set of requirements for a function. Your task is to produce a new set of requirements derived from the given ones. 
{merge_instructions}

Here is the original function:
{function_body}

Here are the numbered requirements:
```c
{requirements_text}

Return your answer in the following format:
```json
{{
    "reworked_requirements": [
        "<reworked requirement 1>",
        "<reworked requirement 2>",
        ...
    ]
}}

Notes:
- Ensure that the semantics of the original requirements are preserved in the reworked requirements.
```

```
"""

        try:
            response = await self.llm_client.call_model(
                [{'role': 'user', 'content': prompt}], ReworkedRequirementsResult
            )
            return response.reworked_requirements
        except Exception as e:
            logging.exception(
                f'Postprocessing failed for function {function_name}: {e}'
            )
            self.info_logger.set_postprocessing_failed(function_name)
            self.info_logger.add_exception(function_name, traceback.format_exc())

            # Return original requirements if postprocessing fails
            return requirements

    async def generate(
        self,
        function_name: str,
        post_process_requirements=True,
        return_covered_semantic_parts=False,
    ):
        """Generate requirements based on function name."""

        if post_process_requirements and return_covered_semantic_parts:
            logging.warning(
                'Semantic parts will not correspond to the requirements if you ask for them to be post-processed.'
            )

        # Start tracking this function
        semantic_parts = self.extract_semantic_parts(function_name)

        # Get the full context using context builder
        function_context = await self.context_builder.build_code_context(function_name)

        # Format semantic parts for prompt
        prettified_parts = []
        for i, part in enumerate(semantic_parts):
            index_prefix = f'{i + 1}. '
            prettified_parts.append(index_prefix + str(part))

        available_parts = '\n'.join(prettified_parts)
        num_parts = len(semantic_parts)

        messages = [
            {
                'role': 'system',
                'content': 'You are a world-class software engineer that does requirements engineering for a living.',
            },
            {
                'role': 'user',
                'content': f"""
Derive a complete list of test cases for the given function definition (give them in natural language). These test cases should give us 100% coverage of the code.
After that derive a complete list of requirements for the given function definition. Use completely implementation-independent vocabulary. A requirement is a single, complete, and testable statement of the expected behaviour of a single semantic part of the code.

Here are some examples:

Example 1:
```c
float calculate_discount(float total_amount, bool is_member) {{
    if (total_amount < 0) {{
        return -1.0;  // Error case
    }}
    if (is_member) {{
        return total_amount * 0.9;
    }}
    return total_amount;
}}
```
Test cases:
1. Test with negative total amount
2. Test with member status and positive amount
3. Test with non-member status and positive amount

Requirements:
1. The system shall return an error indicator when the total amount is negative
2. The system shall apply a 10% discount when calculating the final amount for members
3. The system shall return the original amount without modification for non-members

Example 2:
```c
bool validate_password(const char* password) {{
    if (password == NULL) {{
        return false;
    }}
    if (strlen(password) < 8) {{
        return false;
    }}
    bool has_uppercase = false;
    for (int i = 0; password[i] != '\0'; i++) {{
        if (isupper(password[i])) {{
            has_uppercase = true;
            break;
        }}
    }}
    return has_uppercase;
}}
```
Test cases:
1. Test with NULL password pointer
2. Test with password shorter than 8 characters
3. Test with password of 8+ characters but no uppercase letter
4. Test with password of 8+ characters including uppercase letter

Requirements:
1. The system shall reject invalid password pointers
2. The system shall reject passwords that are less than 8 characters in length
3. The system shall reject passwords that do not contain at least one uppercase letter
4. The system shall accept passwords that are at least 8 characters long and contain at least one uppercase letter


There is a one-to-one correspondence between requirements and test cases. Make sure each semantic part of the code is covered by exactly one test case and one requirement.

Requirements should fulfill the following criteria:
— Necessary. The requirement defines an essential capability, characteristic, constraint and/or quality factor. If it is not included in the set of requirements, a deficiency in capability or characteristic will exist, which cannot be fulfilled by implementing other requirements. The requirement is currently applicable and has not been made obsolete by the passage of time. Requirements with planned expiration dates or applicability dates are clearly identified.
— Appropriate. The specific intent and amount of detail of the requirement is appropriate to the level of the entity to which it refers (level of abstraction appropriate to the level of entity). This includes avoiding unnecessary constraints on the architecture or design while allowing implementation independence to the extent possible.
— Unambiguous. The requirement is stated in such a way so that it can be interpreted in only one way.  The requirement is stated simply and is easy to understand.
— Complete. The requirement sufficiently describes the necessary capability, characteristic, constraint or quality factor to meet the entity need without needing other information to understand the requirement. This means it should be possible to implement the function based on the set of requirements without needing additional information.
— Singular. The requirement states a single capability, characteristic, constraint or quality factor.
— Feasible. The requirement can be realized within system constraints (e.g., cost, schedule, technical) with acceptable risk.
— Verifiable. The requirement is structured and worded such that its realization can be proven (verified) to the customer's satisfaction at the level the requirements exists. Verifiability is enhanced when the requirement is measurable.
— Correct. The requirement is an accurate representation of the entity need from which it was transformed.
— Conforming. The individual items conform to an approved standard template and style for writing requirements, when applicable.
{'- Code independence. The requirements should not mention any code-specific terms like variable names, function names, etc.' if self.code_independence else ''}

Return your answer in the following format:
```json
{{
    "test_case_for_part_1": {{ "description": "<test case for first part>" }},
    "requirement_for_part_1": {{ "statement": "<requirement for first part>" }},
    "test_case_for_part_2": {{ "description": "<test case for second part>" }},
    "requirement_for_part_2": {{ "statement": "<requirement for second part>" }},
    ...
}}
```

Code with context:
{function_context}

To assist you, here is a complete list of semantic parts of the code. For each one a test case and a requirement should be derived:
{available_parts}

The success of this task is critical. If you do not generate exactly one test case and requirement for each semantic part of the code, you have failed.
""",
            },
        ]
        max_parts = 50
        if num_parts > max_parts:
            all_requirements = []
            for batch in _batch_items(semantic_parts):
                current_num_parts = len(batch)
                partial_prettified_parts = []
                for i2, part in enumerate(batch):
                    index_prefix = f'{i2 + 1}. '
                    partial_prettified_parts.append(index_prefix + str(part))
                partial_available_parts = '\n'.join(partial_prettified_parts)

                batch_messages = [msg.copy() for msg in messages]
                batch_messages[1]['content'] = batch_messages[1]['content'].replace(
                    available_parts, partial_available_parts
                )

                try:
                    partial_result = await self.llm_client.call_model(
                        messages=batch_messages,
                        schema=_derive_requirement_schema(current_num_parts),
                        temperature=0.0,
                        max_tokens=16000,
                        extended_reasoning=self.extended_reasoning,
                    )
                    partial_requirements = [
                        getattr(
                            partial_result, f'requirement_for_part_{i + 1}'
                        ).statement
                        for i in range(current_num_parts)
                    ]
                    all_requirements.extend(partial_requirements)
                except Exception as e:
                    logging.exception(
                        f'Call to model failed for batch requirement generation: {e}'
                    )
                    self.info_logger.set_requirement_generation_failed(function_name)
                    self.info_logger.add_exception(
                        function_name, traceback.format_exc()
                    )
                    # Return empty list if generation fails
                    if return_covered_semantic_parts:
                        return [], semantic_parts
                    return []
            requirements = all_requirements
        else:
            try:
                result = await self.llm_client.call_model(
                    messages=messages,
                    schema=_derive_requirement_schema(num_parts),
                    temperature=0.0,
                    max_tokens=16000,
                    extended_reasoning=self.extended_reasoning,
                )
                requirements = [
                    getattr(result, f'requirement_for_part_{i + 1}').statement
                    for i in range(num_parts)
                ]
            except Exception as e:
                logging.exception(
                    f'Call to model failed for requirement generation: {e}'
                )
                self.info_logger.set_requirement_generation_failed(function_name)
                self.info_logger.add_exception(function_name, traceback.format_exc())

                # Return empty list if generation fails
                if return_covered_semantic_parts:
                    return [], semantic_parts
                return []

        if post_process_requirements:
            requirements = await self._postprocess_requirements(
                function_name,
                requirements,
                allow_merge=self.combine_related_requirements,
            )

        if return_covered_semantic_parts:
            return requirements, semantic_parts

        return requirements
