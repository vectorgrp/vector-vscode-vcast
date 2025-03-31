import os
import logging
import typing as t
from pathlib import Path

import yaml
import backoff
from aiolimiter import AsyncLimiter
import openai
from openai import AsyncOpenAI, AsyncAzureOpenAI
from dotenv import load_dotenv


load_dotenv()
RATE_LIMIT = AsyncLimiter(30, 60)
_config_files_dir = Path(__file__).resolve().parent / '.config'
logging.info(f'Loading config files from {_config_files_dir}')


class Config:
    _supported_providers = tuple([f.stem for f in _config_files_dir.glob('*.yml')])

    def __init__(self, provider: str, **kwargs):
        assert provider in self.supported_providers, f'Provider {provider} is not supported'
        self.provider = provider
        for k, v in kwargs.items():
            setattr(self, k, os.getenv(k) or v or None)

    def __getitem__(self, item):
        try:
            return getattr(self, item)
        except AttributeError as e:
            logging.error(f"Item {item} is expected to be in the config file for this provider.")
            raise e

    def __str__(self):
        return f"Config(provider={self.provider}, n_attributes={len(self.__dict__)})"

    @property
    def supported_providers(self):
        return self._supported_providers


def init_config(provider: str):
    config_path = _config_files_dir / f'{provider}.yml'
    if not config_path.exists():
        raise FileNotFoundError(f'Config file for provider {provider} not found. Supported providers: {Config._supported_providers}')

    with open(config_path) as f:
        return Config(provider, **yaml.safe_load(f))


class LLMClient:
    def __init__(self, provider: str = os.getenv('LLM_PROVIDER', 'azure_openai')):
        self.config = init_config(provider)
        logging.info(f'Using config: {self.config}')
        self.provider = provider

        if self.provider == 'azure_openai':
            self.client = AsyncAzureOpenAI(
                api_key=self.config.API_KEY,
                api_version=self.config.API_VERSION,
                azure_endpoint=self.config.BASE_URL,
                azure_deployment=self.config.DEPLOYMENT
            )
        elif self.is_openai_compatible():
            self.client = AsyncOpenAI(
                api_key=self.config.API_KEY if (hasattr(self.config, 'API_KEY') and self.config.API_KEY) else 'none',
                base_url=self.config.BASE_URL,
            )
        else:
            raise NotImplementedError(f'Provider {provider} is not supported')

        self.token_usage = {
            'generation': {'input_tokens': 0, 'output_tokens': 0},
            'reasoning': {'input_tokens': 0, 'output_tokens': 0}
        }

    def is_openai_compatible(self):
        return self.provider in ('ollama',)

    exceptions = (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError)
    @backoff.on_exception(backoff.expo, exceptions, max_time=120)
    async def call_model(self, messages: t.List[t.Dict[str, str]], schema, temperature=0.0, max_tokens=5000, seed=42, extended_reasoning=False, return_raw_completion=False, **kwargs):
        async with RATE_LIMIT:
            try:
                kwargs.update(
                    {
                        'model': self.config.MODEL_NAME,
                        'messages': messages,
                        'response_format': schema,
                        'temperature': temperature,
                        'seed': seed,
                        'max_completion_tokens': max_tokens
                    }
                )
                completion = await self.client.beta.chat.completions.parse(
                    **kwargs
                )

                # Update token usage for the generation model
                self.token_usage['generation']['input_tokens'] += completion.usage.prompt_tokens
                self.token_usage['generation']['output_tokens'] += completion.usage.completion_tokens
            except Exception as e:
                if isinstance(e, openai.LengthFinishReasonError):
                    self.token_usage['generation']['input_tokens'] += e.completion.usage.prompt_tokens
                    self.token_usage['generation']['output_tokens'] += e.completion.usage.completion_tokens
                raise e

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
