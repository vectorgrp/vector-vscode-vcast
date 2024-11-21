from typing import List, Tuple
import ast
from dcheck.processing.code_extraction import FunctionDef
from pydantic import BaseModel

class Requirement(BaseModel):
    requirement_text: str

class DesignDecompositionResult(BaseModel):
    code_paths: List[str]
    designed_code_paths: List[str]
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
                "content": "You are a world-class software engineer that does requirements engineering for a living."
            },
            {
                "role": "user",
                "content": f"""
Derive a complete list of requirements for the given function definition. Use only vocabulary used in the design, not the code. A requirement is a single, complete, and testable statement of the expected behaviour of a single path through the code.
                
Design:
{func_def.design}

Code:
{func_def.code}

To solve this task, first enumerate all potential paths through the code. A path is fully defined by a series of IF (both in code and the preprocessor) conditions and the decision made at each. Ignore looping constructs when deriving the paths.
Then enumerate all paths you just derived and only keep those who have been explicitly designed.
For each such path, derive the expected behaviour of the code path. This behaviour should be a single, complete, and testable statement. It has to be understandable independent of other requirements.

The success of this task is critical. The purpose is to derive unit tests, exactly one per requirement, that will test the behaviour of the exact code path described in the final requirements_text.
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