import os
from aiolimiter import AsyncLimiter
from openai import AsyncAzureOpenAI
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

RATE_LIMIT = AsyncLimiter(30, 60)

class LLMClient:
    def __init__(self):
        self.client = AsyncAzureOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),  
            api_version="2024-08-01-preview",
            azure_endpoint=os.getenv("OPENAI_API_BASE"),
            azure_deployment=os.getenv("OPENAI_GENERATION_DEPLOYMENT")
        )
        self.reasoning_client = AsyncAzureOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),
            api_version="2024-08-01-preview",
            azure_endpoint=os.getenv("OPENAI_API_BASE"),
            azure_deployment=os.getenv("OPENAI_ADVANCED_GENERATION_DEPLOYMENT")
        )
        self.token_usage = {
            'generation': {'input_tokens': 0, 'output_tokens': 0},
            'reasoning': {'input_tokens': 0, 'output_tokens': 0}
        }

    async def call_model(self, messages: List[Dict[str, str]], schema, temperature=0.0, max_tokens=5000, seed=42, extended_reasoning=False, return_raw_completion=False, **kwargs):
        async with RATE_LIMIT:
            if extended_reasoning:
                raise ValueError("Copilot cannot be used with extended reasoning.")

            model = "gpt-4o" if extended_reasoning else "o1-mini"

            if extended_reasoning:
                messages = [m for m in messages if m["role"] != "system"]

            if not extended_reasoning:
                completion = await self.client.beta.chat.completions.parse(
                    model=model,
                    messages=messages,
                    response_format=schema,
                    temperature=temperature,
                    seed=seed,
                    max_tokens=max_tokens,
                    **kwargs
                )
                # Update token usage for the generation model
                self.token_usage['generation']['input_tokens'] += completion.usage.prompt_tokens
                self.token_usage['generation']['output_tokens'] += completion.usage.completion_tokens
            else:
                raw_completion = await self.reasoning_client.chat.completions.create(
                    model=model,
                    messages=messages
                )
                # Update token usage for the reasoning model
                self.token_usage['reasoning']['input_tokens'] += raw_completion.usage.prompt_tokens
                self.token_usage['reasoning']['output_tokens'] += raw_completion.usage.completion_tokens

                completion = await self.client.beta.chat.completions.parse(
                    model="gpt-4o",
                    messages=messages + [
                        {"role": "assistant", "content": raw_completion.choices[0].message.content},
                        {"role": "user", "content": "Please convert this into JSON."}
                    ],
                    response_format=schema,
                    temperature=temperature,
                    max_tokens=5000
                )
                # Update token usage for parsing step (considered as generation model)
                self.token_usage['generation']['input_tokens'] += completion.usage.prompt_tokens
                self.token_usage['generation']['output_tokens'] += completion.usage.completion_tokens

            if return_raw_completion:
                return completion, raw_completion

            return completion.choices[0].message.parsed

    def get_token_usage(self):
        return self.token_usage

    @property
    def total_cost(self):
        generation_input_tokens = self.token_usage['generation']['input_tokens']
        generation_output_tokens = self.token_usage['generation']['output_tokens']
        reasoning_input_tokens = self.token_usage['reasoning']['input_tokens']
        reasoning_output_tokens = self.token_usage['reasoning']['output_tokens']

        # Pricing in Dollar ($)
        generation_input_cost = (generation_input_tokens / 1000) * 0.00275
        generation_output_cost = (generation_output_tokens / 1000) * 0.011
        reasoning_input_cost = (reasoning_input_tokens / 1000) * 0.003  # Assuming different pricing
        reasoning_output_cost = (reasoning_output_tokens / 1000) * 0.012  # Adjust as per actual pricing

        total_cost = generation_input_cost + generation_output_cost + reasoning_input_cost + reasoning_output_cost
        return {
            'generation': {
                'input_tokens': generation_input_tokens,
                'output_tokens': generation_output_tokens,
                'input_cost': generation_input_cost,
                'output_cost': generation_output_cost
            },
            'reasoning': {
                'input_tokens': reasoning_input_tokens,
                'output_tokens': reasoning_output_tokens,
                'input_cost': reasoning_input_cost,
                'output_cost': reasoning_output_cost
            },
            'total_cost': total_cost
        }