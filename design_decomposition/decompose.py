from typing import List
import ast
from dcheck.processing.code_extraction import FunctionDef
from pydantic import BaseModel

class Requirement(BaseModel):
    requirement_text: str

class DesignDecompositionResult(BaseModel):
    requirements: List[Requirement]

class DesignDecomposer:
    def __init__(self):
        import openai
        import os
        self.client = openai.AzureOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),  
            api_version="2024-08-01-preview",
            azure_endpoint=os.getenv("OPENAI_API_BASE"),
            azure_deployment=os.getenv("OPENAI_GENERATION_DEPLOYMENT")
        )

    def decompose_design(self, func_def):
        messages = [
            {
                "role": "system",
                "content": "You are a world-class software engineer."
            },
            {
                "role": "user",
                "content": f"""
Please decompose this high-level design into individual flows/paths/requirements through the code, such that each flow/requirements can be tested separately by a single unit test.

Code:
{func_def.code}

High-level design:
{func_def.design}

Clarification of terms:
- High-level design: A description of the code's behaviour, in effect often a textual version of the code.
- Low-level functional requirement: A textual description of the expected behaviour of a single path through the code. Often only one or two sentences.

Detailed task description:
Translate the given high-level design into a list of low-level requirements.

Solve the problem by translating the high-level design into a list of low-level requirements one by one. For each one:
1. Describe the single code path this requirement describes in terms of the path taken at branch points in the code (if, switch, while, for, etc.). This description should be complete and not rely on the reader's knowledge of the code or other requirements.
2. Describe the expected behaviour of the code path.

Notes:
- The crucial difference between design and requirement then, is that the design covers all paths through the code, while a requirement only covers a single path.
- Each requirement should be detailed enough that a developer could implement the code to meet the requirement without further clarification.
- Each requirement should be self-contained, i.e. not refer to information contained explicitly or implicitly in other requirements.
- No requirement should be a subset of another requirement.
- Taken together, the requirements should allow a developer to reconstruct the high-level design.
- If you create a requirement that depends on having read another requirement to understand it, you have FAILED. Avoid this at all costs, be repetetive if necessary.
"""
            }
        ]

        completion = self.client.beta.chat.completions.parse(
            model="gpt-4o",
            messages=messages,
            response_format=DesignDecompositionResult,
            temperature=0.0,
            seed=42,
            max_tokens=2000,
        )

        return completion.choices[0].message.parsed