from typing import List
from pydantic import BaseModel
from .llm_client import LLMClient  # Import the LLMClient

class TextRange(BaseModel):
    start_line: int
    end_line: int

class SearchOutput(BaseModel):
    ranges: List[TextRange]

class SearchEngine:
    def __init__(self, reference):
        self.reference = reference
        self.llm_client = LLMClient()  # Use LLMClient instead of OpenAI client

    async def search(self, query: str) -> List[TextRange]:
        # Add line numbers to the text
        numbered_text = "\n".join(f"{i + 1}: {line}" for i, line in enumerate(self.reference.splitlines()))
        
        messages = [
            {
                "role": "system",
                "content": "You are an assistant that finds relevant parts of a text based on a query."
            },
            {
                "role": "user",
                "content": f"""
Please retrieve all relevant text ranges in the large reference to address the information need for the input user query.

Reference:
{numbered_text}

User query:
{query}

Provide the output in JSON format as follows:
{{
    "ranges": [
        {{"start_line": int, "end_line": int}},
        ...
    ]
}}

Notes:
- Be sure to include ALL relevant ranges
- Do not cut off semantic elements like sections, functions, etc. of the reference in the middle. Return the whole thing.
- Ranges are inclusive of both the start and end lines
"""
            }
        ]

        result = await self.llm_client.call_model(
            messages, SearchOutput, temperature=0.0, max_tokens=15000, extended_reasoning=False
        )

        # First sort the ranges and then merge adjacent ranges
        result.ranges.sort(key=lambda x: x.start_line)
        merged_ranges = []
        
        for text_range in result.ranges:
            if not merged_ranges or text_range.start_line > merged_ranges[-1].end_line + 1:
                merged_ranges.append(text_range)
            else:
                merged_ranges[-1].end_line = text_range.end_line
                
        # Now construct the parts of the text that are relevant to the query
        relevant_text_parts = []
        for text_range in merged_ranges:
            relevant_text_parts.append("\n".join(self.reference.splitlines()[max(text_range.start_line-1, 0):max(text_range.end_line+1, 0)]) + "\n")

        # Merge the parts into a single string
        relevant_text = "\n\n...\n\n".join(relevant_text_parts)
        
        return relevant_text