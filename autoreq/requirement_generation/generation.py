from typing import List
from pydantic import BaseModel, create_model

from ..llm_client import LLMClient

class DesignDecompositionResult(BaseModel):
    requirements: List[str]

    @property
    def with_requirement_indices(self):
        return DesignDecompositionResult(
            requirements=[f"Requirement {i + 1}: {req}" for i, req in enumerate(self.without_requirement_indices.requirements)]
        )

    @property
    def without_requirement_indices(self):
        return DesignDecompositionResult(
            requirements=[req.split(":", 1)[1].strip() if ":" in req else req for req in self.requirements]
        )

class DesignDecompositionResultWithTestcases(BaseModel):
    test_cases: List[str]
    requirements: List[str]

    @property
    def without_tests(self):
        return DesignDecompositionResult(
            requirements=self.requirements
        )

def _derive_requirement_schema(num_paths):
    """Creates a dynamic schema that forces exactly one requirement per path."""
    
    class TestCase(BaseModel):
        description: str

    class Requirement(BaseModel):
        statement: str

    # Create fields for each path
    result_keys = {
        f"test_case_for_path_{i+1}": (TestCase, ...) for i in range(num_paths)
    }
    result_keys.update({
        f"requirement_for_path_{i+1}": (Requirement, ...) for i in range(num_paths)
    })

    return create_model('RequirementGenerationResult', **result_keys)

def _batch_paths(paths, batch_size=50):
    for i in range(0, len(paths), batch_size):
        yield paths[i:i+batch_size]

class PathEnumerationResult(BaseModel):
    paths: List[str]

class RequirementsGenerator:
    def __init__(self, environment, code_independence: bool = False, extended_reasoning: bool = False):
        self.llm_client = LLMClient()
        self.environment = environment
        self.code_independence = code_independence
        self.extended_reasoning = extended_reasoning

    async def _get_available_paths(self, function_body: str, function_name: str) -> List[str]:
        """Returns a list of paths through the given function"""

        paths = []
        any_found = False
        for test in self.environment.atg_tests:
            if test.subprogram_name.endswith(function_name):
                any_found = True
                if test.path:  # Only include if path is not empty
                    paths.append(test.path)

        if any_found:
            return paths

        # Fallback to generating paths using LLM
        messages = [
            {
                "role": "system",
                "content": "You are an expert in software engineering and path analysis."
            },
            {
                "role": "user",
                "content": f"""
Analyze the following function and enumerate all possible execution paths through the code.
Return the paths in a list format.

Function:
{function_body}

Return the paths in a clear, structured format. Each path should be labeled and should include both the conditions and the sequence of statements.
"""
            }
        ]

        #  In case there are too many limit yourself to 20.

        result = await self.llm_client.call_model(
            messages=messages,
            schema=PathEnumerationResult,
            temperature=0.0
        )

        return self._process_enumerated_paths(result.paths)

    def _process_enumerated_paths(self, raw_paths: List[str]) -> List[str]:
        """Process and validate the paths returned by the LLM."""
        processed_paths = []
        for path in raw_paths:
            # Remove any path numbers or labels
            cleaned_path = path.split(":", 1)[-1].strip()
            # Remove any leading dashes or bullets
            cleaned_path = cleaned_path.lstrip("- *•")
            processed_paths.append(cleaned_path)
        return processed_paths

    async def generate(self, function_body, function_name):
        paths = await self._get_available_paths(function_body, function_name)
        prettified_paths = []
        for i, path in enumerate(paths):
            index_prefix = f"{i+1}. "
            path_lines = path.split("\n")
            indented_path = path_lines[0] + "".join("\n" + " " * len(index_prefix) + line for line in path_lines[1:])
            prettified_paths.append(index_prefix + indented_path)

        available_paths = "\n".join(prettified_paths) if prettified_paths else "Only one path through the code is available."
        num_paths = len(paths) if paths else 1

        messages = [
            {
                "role": "system",
                "content": "You are a world-class software engineer that does requirements engineering for a living."
            },
            {
                "role": "user",
                "content": f"""
Derive a complete list of test cases for the given function definition (give them in natural language). These test cases should give us 100% path coverage of the code.
After that derive a complete list of requirements for the given function definition. Use completely implementation-independent vocabulary. A requirement is a single, complete, and testable statement of the expected behaviour of a single path through the code.

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


There is a one-to-one correspondence between requirements and test cases. Make sure each path through the code is covered by exactly one test case and one requirement.

Requirements should fulfill the following criteria:
— Necessary. The requirement defines an essential capability, characteristic, constraint and/or quality factor. If it is not included in the set of requirements, a deficiency in capability or characteristic will exist, which cannot be fulfilled by implementing other requirements. The requirement is currently applicable and has not been made obsolete by the passage of time. Requirements with planned expiration dates or applicability dates are clearly identified.
— Appropriate. The specific intent and amount of detail of the requirement is appropriate to the level of the entity to which it refers (level of abstraction appropriate to the level of entity). This includes avoiding unnecessary constraints on the architecture or design while allowing implementation independence to the extent possible.
— Unambiguous. The requirement is stated in such a way so that it can be interpreted in only one way.  The requirement is stated simply and is easy to understand.
— Complete. The requirement sufficiently describes the necessary capability, characteristic, constraint or quality factor to meet the entity need without needing other information to understand the requirement.
— Singular. The requirement states a single capability, characteristic, constraint or quality factor.
— Feasible. The requirement can be realized within system constraints (e.g., cost, schedule, technical) with acceptable risk.
— Verifiable. The requirement is structured and worded such that its realization can be proven (verified) to the customer's satisfaction at the level the requirements exists. Verifiability is enhanced when the requirement is measurable.
— Correct. The requirement is an accurate representation of the entity need from which it was transformed.
— Conforming. The individual items conform to an approved standard template and style for writing requirements, when applicable.
{ "- Code independence. The requirements should not mention any code-specific terms like variable names, function names, etc." if self.code_independence else "" }

Return your answer in the following format:
```json
{{
    "test_case_for_path_1": {{ "description": "<test case for first path>" }},
    "requirement_for_path_1": {{ "statement": "<requirement for first path>" }},
    "test_case_for_path_2": {{ "description": "<test case for second path>" }},
    "requirement_for_path_2": {{ "statement": "<requirement for second path>" }},
    ...
}}
```

Code:
{function_body}

To assist you, here is a complete list of paths through the code. For each one a test case and a requirement should be derived:
{available_paths}

The success of this task is critical. If you do not generate exactly one test case and requirement for each path through the code, you have failed.
"""
            }
        ]

        if num_paths > 50:
            all_requirements = []
            for batch in _batch_paths(paths):
                current_num_paths = len(batch)
                partial_prettified_paths = []
                for i2, path in enumerate(batch):
                    index_prefix = f"{i2+1}. "
                    path_lines = path.split("\n")
                    indented_path = path_lines[0] + "".join("\n" + " " * len(index_prefix) + line for line in path_lines[1:])
                    partial_prettified_paths.append(index_prefix + indented_path)
                partial_available_paths = "\n".join(partial_prettified_paths)

                batch_messages = [
                    {
                        "role": "system",
                        "content": "You are a world-class software engineer that does requirements engineering for a living."
                    },
                    {
                        "role": "user",
                        "content": f"""
Derive a complete list of test cases for the given function definition (give them in natural language). These test cases should give us 100% path coverage of the code.
After that derive a complete list of requirements for the given function definition. Use completely implementation-independent vocabulary. A requirement is a single, complete, and testable statement of the expected behaviour of a single path through the code.

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


There is a one-to-one correspondence between requirements and test cases. Make sure each path through the code is covered by exactly one test case and one requirement.

Requirements should fulfill the following criteria:
— Necessary. The requirement defines an essential capability, characteristic, constraint and/or quality factor. If it is not included in the set of requirements, a deficiency in capability or characteristic will exist, which cannot be fulfilled by implementing other requirements. The requirement is currently applicable and has not been made obsolete by the passage of time. Requirements with planned expiration dates or applicability dates are clearly identified.
— Appropriate. The specific intent and amount of detail of the requirement is appropriate to the level of the entity to which it refers (level of abstraction appropriate to the level of entity). This includes avoiding unnecessary constraints on the architecture or design while allowing implementation independence to the extent possible.
— Unambiguous. The requirement is stated in such a way so that it can be interpreted in only one way.  The requirement is stated simply and is easy to understand.
— Complete. The requirement sufficiently describes the necessary capability, characteristic, constraint or quality factor to meet the entity need without needing other information to understand the requirement.
— Singular. The requirement states a single capability, characteristic, constraint or quality factor.
— Feasible. The requirement can be realized within system constraints (e.g., cost, schedule, technical) with acceptable risk.
— Verifiable. The requirement is structured and worded such that its realization can be proven (verified) to the customer's satisfaction at the level the requirements exists. Verifiability is enhanced when the requirement is measurable.
— Correct. The requirement is an accurate representation of the entity need from which it was transformed.
— Conforming. The individual items conform to an approved standard template and style for writing requirements, when applicable.
{ "- Code independence. The requirements should not mention any code-specific terms like variable names, function names, etc." if self.code_independence else "" }

Return your answer in the following format:
```json
{{
    "test_case_for_path_1": {{ "description": "<test case for first path>" }},
    "requirement_for_path_1": {{ "statement": "<requirement for first path>" }},
    "test_case_for_path_2": {{ "description": "<test case for second path>" }},
    "requirement_for_path_2": {{ "statement": "<requirement for second path>" }},
    ...
}}
```

Code:
{function_body}

To assist you, here is a complete list of paths through the code. For each one a test case and a requirement should be derived:
{partial_available_paths}

The success of this task is critical. If you do not generate exactly one test case and requirement for each path through the code, you have failed.
"""
                    }
                ]
                partial_result = await self.llm_client.call_model(
                    messages=batch_messages,
                    schema=_derive_requirement_schema(current_num_paths),
                    temperature=0.0,
                    max_tokens=16000,
                    extended_reasoning=self.extended_reasoning
                )
                partial_requirements = [
                    getattr(partial_result, f"requirement_for_path_{i+1}").statement
                    for i in range(current_num_paths)
                ]
                all_requirements.extend(partial_requirements)
            requirements = all_requirements
        else:
            result = await self.llm_client.call_model(
                messages=messages,
                schema=_derive_requirement_schema(num_paths),
                temperature=0.0,
                max_tokens=16000,
                extended_reasoning=self.extended_reasoning
            )
            requirements = [
                getattr(result, f"requirement_for_path_{i+1}").statement
                for i in range(num_paths)
            ]

        return requirements