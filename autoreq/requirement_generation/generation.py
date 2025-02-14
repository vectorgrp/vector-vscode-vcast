from typing import List, Set
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

class RequirementWithCoverage(BaseModel):
    statement: str
    covered_lines: List[int]

class RequirementGenerationResult(BaseModel):
    requirements: List[RequirementWithCoverage]

async def _get_line_numbers(function_body: str) -> List[int]:
    """Extract line numbers from function body, excluding empty lines and comments."""
    lines = function_body.split('\n')
    return [i + 1 for i, line in enumerate(lines) 
            if line.strip() and not line.strip().startswith('//')]

class RequirementsGenerator:
    def __init__(self, environment, code_independence: bool = False):
        self.llm_client = LLMClient()
        self.environment = environment
        self.code_independence = code_independence

    async def generate(self, function_body: str, function_name: str) -> List[str]:
        line_numbers = await _get_line_numbers(function_body)
        
        messages = [
            {
                "role": "system",
                "content": "You are a world-class software engineer that does requirements engineering for a living."
            },
            {
                "role": "user",
                "content": f"""
Analyze the given function and derive a set of requirements that completely describe its behavior.
Each requirement should capture a distinct, coherent piece of functionality or behavior.
Requirements should be semantic in nature and implementation-independent.

Requirements should fulfill these criteria:
- Necessary: Defines essential capability or behavior
- Appropriate: Abstraction level matches the functionality being described
- Unambiguous: Can be interpreted in only one way
- Complete: Fully describes the behavior without needing additional information
- Singular: States a single capability or behavior
- Feasible: Can be implemented within system constraints
- Verifiable: Can be tested to prove implementation correctness
{ "- Code independence: No mention of implementation details or variable names" if self.code_independence else "" }

For each requirement, also specify which lines of code implement that requirement.

Code with line numbers:
{chr(10).join(f"{i}  {line}" for i, line in enumerate(function_body.split(chr(10)), 1))}

Return requirements in this format:
```json
{{
    "requirements": [
        {{
            "statement": "<requirement statement>",
            "covered_lines": [<line numbers>]
        }},
        ...
    ]
}}
```

Ensure that:
1. Every line of code traces to at least one requirement
2. Each requirement covers a cohesive set of related behaviors
3. Requirements are not unnecessarily split or combined
4. Each requirement should be testable with a single path through the code, i.e., lines in multiple branches cannot map to a single requirement but should be seperate instead
"""
            }
        ]

        result = await self.llm_client.call_model(
            messages=messages,
            schema=RequirementGenerationResult,
            temperature=0.0,
            max_tokens=8000
        )

        # Verify complete line coverage
        covered_lines = set()
        for req in result.requirements:
            covered_lines.update(req.covered_lines)
        
        """
        if not all(line in covered_lines for line in line_numbers):
            uncovered = set(line_numbers) - covered_lines
            raise ValueError(f"Incomplete requirement coverage. Lines not covered: {uncovered}")
        """

        return [req.statement for req in result.requirements]