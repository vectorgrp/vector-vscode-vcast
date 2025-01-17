from typing import List

from pydantic import BaseModel  # Add this import
from openai import AzureOpenAI

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

class RequirementsGenerator:
    def __init__(self, environment, code_independence: bool = False):
        self.llm_client = LLMClient()
        self.environment = environment
        self.code_independence = code_independence

    def _get_available_paths(self, function_name: str) -> List[str]:
        """Returns a list of paths through the given function"""

        paths = []
        for test in self.environment.atg_tests:
            if test.subprogram_name.startswith(function_name):
                if test.path:  # Only include if path is not empty
                    paths.append(test.path)
        return paths

    async def generate(self, function_body, function_name):
        paths = self._get_available_paths(function_name)
        prettified_paths = []
        for i, path in enumerate(paths):
            index_prefix = f"{i+1}. "
            path_lines = path.split("\n")
            indented_path = path_lines[0] + "".join("\n" + " " * len(index_prefix) + line for line in path_lines[1:])
            prettified_paths.append(index_prefix + indented_path)

        available_paths = "\n".join(prettified_paths) if prettified_paths else "Only one path through the code is available."

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

Code:
{function_body}

To assist you, here is a complete list of paths through the code. For each one a test case and a requirement should be derived:
{available_paths}

The success of this task is critical. If you do not generate exactly one test case and requirement for each path through the code, you have failed.
"""
            }
        ]

        with open("req_messages.txt", "w") as f:
            for message in messages:
                f.write(f"{message['role']}: {message['content']}\n\n")

        result = await self.llm_client.call_model(
            messages=messages,
            schema=DesignDecompositionResultWithTestcases,
            temperature=0.0,
            max_tokens=5000
        )

        return result.without_tests.without_requirement_indices.requirements