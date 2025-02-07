
from typing import Optional
from pydantic import BaseModel
from .llm_client import LLMClient

class SummaryOutput(BaseModel):
    summary: str

class SummaryEngine:
    def __init__(self, context: str):
        self.context = context
        self.llm_client = LLMClient()

    async def summarize(
        self, 
        instruction: str,
        max_tokens: int = 1000,
        temperature: float = 0.0
    ) -> str:
        messages = [
            {
                "role": "system",
                "content": "You are an assistant that summarizes text according to specific instructions."
            },
            {
                "role": "user",
                "content": f"""
Please summarize the following context according to these specific instructions:

{instruction}

Context:
{self.context}

Provide your summary in a clear and concise format that matches the requested instructions.
"""
            }
        ]

        result = await self.llm_client.call_model(
            messages, 
            SummaryOutput, 
            temperature=temperature,
            max_tokens=max_tokens,
            extended_reasoning=False
        )

        return result.summary