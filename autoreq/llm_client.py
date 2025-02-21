import os
import backoff
from aiolimiter import AsyncLimiter
from openai import AsyncAzureOpenAI
from typing import List, Dict, Any
from dotenv import load_dotenv
import openai

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
            api_version="2024-12-01-preview",
            azure_endpoint=os.getenv("OPENAI_API_BASE"),
            azure_deployment=os.getenv("OPENAI_ADVANCED_GENERATION_DEPLOYMENT")
        )
        self.token_usage = {
            'generation': {'input_tokens': 0, 'output_tokens': 0},
            'reasoning': {'input_tokens': 0, 'output_tokens': 0}
        }

    @backoff.on_exception(backoff.expo, (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError), max_time=120)
    async def call_model(self, messages: List[Dict[str, str]], schema, temperature=0.0, max_tokens=5000, seed=42, extended_reasoning=False, return_raw_completion=False, **kwargs):
        #with open("last_messages.txt", "w") as f:
        #   for message in messages:
        #       f.write(f"{message['role']}: {message['content']}\n")
            
        async with RATE_LIMIT:
            model = "gpt-4o" if not extended_reasoning else "o3-mini"

            if not extended_reasoning:
                completion = await self.client.beta.chat.completions.parse(
                    model=model,
                    messages=messages,
                    response_format=schema,
                    temperature=temperature,
                    seed=seed,
                    max_completion_tokens=max_tokens,
                    **kwargs
                )

                # Update token usage for the generation model
                self.token_usage['generation']['input_tokens'] += completion.usage.prompt_tokens
                self.token_usage['generation']['output_tokens'] += completion.usage.completion_tokens
            else:
                completion = await self.reasoning_client.beta.chat.completions.parse(
                    model=model,
                    messages=messages,
                    response_format=schema,
                    seed=seed,
                    **kwargs
                )

                self.token_usage['reasoning']['input_tokens'] += completion.usage.prompt_tokens
                self.token_usage['reasoning']['output_tokens'] += completion.usage.completion_tokens

            result = completion.choices[0].message.parsed

            if return_raw_completion:
                return result, completion
            else:
                return result

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
        reasoning_input_cost = (reasoning_input_tokens / 1000) * 0.0011  # Assuming different pricing
        reasoning_output_cost = (reasoning_output_tokens / 1000) * 0.0044  # Adjust as per actual pricing

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