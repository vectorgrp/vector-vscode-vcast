from functools import cached_property
import os
import logging
import typing as t
from pathlib import Path
import yaml
import backoff
from aiolimiter import AsyncLimiter
import openai
from openai import AsyncOpenAI, AsyncAzureOpenAI
import anthropic
import instructor
from dotenv import load_dotenv
from sys import exit
from autoreq.replay import RequestReplay

load_dotenv()

# TODO: Ensure we have json schemas for how providers need to be configured, perhaps using pydantic

RATE_LIMIT = AsyncLimiter(30, 60)
TIMEOUT = 600
SUPPORTED_PROVIDERS = ('azure_openai', 'ollama', 'anthropic')
OPENAI_COMPATIBLE_PROVIDERS = ('ollama', 'openai')

INCOMPATIBLE_ARGS = {
    'o3-mini': ['temperature', 'max_completion_tokens'],
    'o4-mini': ['temperature', 'max_completion_tokens'],
}

EXAMPLE_CONFIGS = {
    'mistral': {
        'PROVIDER': 'ollama',
        'API_KEY': 'none',
        'BASE_URL': 'http://localhost:11434/v1/',
        'MODEL_NAME': 'mistral',
    },
    'gpt-4.1-azure': {
        'PROVIDER': 'azure_openai',
        'API_KEY': 'none',
        'API_VERSION': '2024-12-01-preview',
        'BASE_URL': 'https://rg-example.openai.azure.com',
        'DEPLOYMENT': 'gpt-4.1-example',
        'MODEL_NAME': 'gpt-4.1',
    },
    'gpt-o4mini-azure': {
        'PROVIDER': 'azure_openai',
        'API_KEY': 'none',
        'API_VERSION': '2024-12-01-preview',
        'BASE_URL': 'https://rg-example.openai.azure.com',
        'DEPLOYMENT': 'o4-mini-example',
        'MODEL_NAME': 'o4-mini',
    },
    'claude-3-7-sonnet': {
        'PROVIDER': 'anthropic',
        'API_KEY': 'none',
        'MODEL_NAME': 'claude-3-7-sonnet-20250219',
    },
}


class Config:
    def __init__(self, config_name: str):
        self._model_files_dir = Path(
            os.getenv(
                'REQ2TESTS_MODELS_PATH', Path.home() / '.req2tests-data' / 'models'
            )
        )

        if not self._model_files_dir.exists():
            logging.info(f'Creating config directory {self._model_files_dir}')
            os.makedirs(self._model_files_dir, exist_ok=True)
            logging.info('Generating config file templates')

            for _config_name, config_info in EXAMPLE_CONFIGS.items():
                config_path = self._model_files_dir / f'{_config_name}.yml'
                with open(config_path, 'w') as f:
                    yaml.dump(config_info, f, default_flow_style=False)

            logging.error(f"""Created a new model directory in {self._model_files_dir}. Add your 
                            model.yml files there or set REQ2TEST_MODELS_PATH to point to an existing
                            folder with your model files.""")
            exit(1)

        logging.info(f'Loading config files from {self._model_files_dir}')

        available_models = [f.stem for f in self._model_files_dir.glob('*.yml')]

        self._model_file = self._model_files_dir / f'{config_name}.yml'

        if not self._model_file.exists():
            logging.error(
                f'Config file {self._model_file} for model {config_name} not found. Available models: {available_models}'
            )

            exit(1)

        model_config = yaml.safe_load(self._model_file.read_text())

        assert 'PROVIDER' in model_config, (
            f'Config file {self._model_file} for model {config_name} does not contain a PROVIDER key.'
        )

        # Now set the attributes
        for k, v in model_config.items():
            # setattr(self, k, os.getenv(k) or v or None)
            setattr(self, k, os.getenv(config_name.upper() + '_' + k) or v or None)

        assert self.PROVIDER in SUPPORTED_PROVIDERS, (
            f'Provider {self.provider} is not supported. List of supported providers: {SUPPORTED_PROVIDERS}'
        )

    def __getitem__(self, item):
        try:
            return getattr(self, item)
        except AttributeError as e:
            logging.error(
                f'Item {item} is expected to be in the config file for this provider.'
            )
            raise e

    def __str__(self):
        return f'Config(provider={self.PROVIDER}, n_attributes={len(self.__dict__)})'


class LLMClient:
    def __init__(
        self,
        model_name: str = os.getenv('REQ2TESTS_MODEL', 'gpt-4.1-azure'),
        reasoning_model_name: str = os.getenv(
            'REQ2TESTS_REASONING_MODEL', 'gpt-o4mini-azure'
        ),
    ):
        self.config = Config(model_name)
        self.reasoning_config = Config(reasoning_model_name)
        logging.info(f'Using config: {self.config}')
        logging.info(f'Using reasoning config: {self.reasoning_config}')

        self.token_usage = {
            'generation': {'input_tokens': 0, 'output_tokens': 0},
            'reasoning': {'input_tokens': 0, 'output_tokens': 0},
        }

    @property
    def provider(self):
        return self.config.PROVIDER

    @property
    def reasoning_provider(self):
        return self.reasoning_config.PROVIDER

    @cached_property
    def client(self):
        return self._provider_to_client(self.provider, self.config)

    @cached_property
    def reasoning_client(self):
        return self._provider_to_client(self.reasoning_provider, self.reasoning_config)

    def _provider_to_client(self, provider, config):
        if provider == 'azure_openai':
            return AsyncAzureOpenAI(
                api_key=config.API_KEY,
                api_version=config.API_VERSION,
                azure_endpoint=config.BASE_URL,
                azure_deployment=config.DEPLOYMENT,
            )
        elif self._is_openai_compatible(provider):
            return AsyncOpenAI(
                api_key=config.API_KEY
                if (hasattr(config, 'API_KEY') and config.API_KEY)
                else 'none',
                base_url=config.BASE_URL,
            )
        elif provider == 'anthropic':
            return instructor.from_anthropic(
                anthropic.AsyncAnthropic(api_key=config.API_KEY, timeout=TIMEOUT)
            )
        else:
            raise NotImplementedError(f'Provider {provider} is not supported')

    def _is_openai_compatible(self, provider):
        return provider in OPENAI_COMPATIBLE_PROVIDERS

    exceptions = (
        openai.RateLimitError,
        openai.APITimeoutError,
        openai.APIConnectionError,
        openai.ContentFilterFinishReasonError,
        openai.LengthFinishReasonError,
    )

    @cached_property
    def request_replayer(self):
        """Initialize request replay cache if enabled."""
        store_dir = os.getenv('REQ2TESTS_STORE_REQUESTS_DIR', None)
        replay_dir = os.getenv('REQ2TESTS_REPLAY_REQUESTS_DIR', None)

        if store_dir and replay_dir:
            raise ValueError(
                'Both REQ2TESTS_STORE_REQUESTS_DIR and REQ2TESTS_REPLAY_REQUESTS_DIR are set. '
                'Please set only one of them.'
            )

        if store_dir or replay_dir:
            return RequestReplay(store_dir or replay_dir)

        return None

    @property
    def request_replay_enabled(self):
        """Check if request replay is enabled."""
        return os.getenv('REQ2TESTS_REPLAY_REQUESTS_DIR') is not None

    @property
    def request_store_enabled(self):
        """Check if request storing is enabled."""
        return os.getenv('REQ2TESTS_STORE_REQUESTS_DIR') is not None

    @backoff.on_exception(backoff.expo, exceptions, max_time=120, max_tries=3)
    async def call_model(
        self,
        messages: t.List[t.Dict[str, str]],
        schema,
        temperature=0.0,
        max_tokens=5000,
        seed=42,
        extended_reasoning=False,
        **kwargs,
    ):
        original_kwargs = kwargs.copy()

        # Create input signature for caching/replay
        inputs = {
            'messages': messages,
            'schema': schema,
            'temperature': temperature,
            'max_tokens': max_tokens,
            'seed': seed,
            'extended_reasoning': extended_reasoning,
            'additional_args': original_kwargs,
        }

        if self.request_replay_enabled:
            replayed_result = self.request_replayer.replay(inputs)
            if replayed_result is not None:
                return replayed_result
            else:
                raise ValueError(
                    'No cached response found for the given inputs. '
                    'Ensure that the request has been stored previously.'
                )

        async with RATE_LIMIT:
            try:
                call_config = (
                    self.config if not extended_reasoning else self.reasoning_config
                )
                call_client = (
                    self.client if not extended_reasoning else self.reasoning_client
                )
                call_type = 'generation' if not extended_reasoning else 'reasoning'

                if call_config.PROVIDER == 'anthropic':
                    completion = await call_client.chat.completions.create(
                        model=call_config.MODEL_NAME,
                        max_tokens=max_tokens,
                        response_model=schema,
                        messages=messages,
                        temperature=temperature,
                    )

                    # Estimate token usage for Anthropic
                    input_tokens = sum(len(m.get('content', '')) for m in messages) // 4
                    output_tokens = len(str(completion)) // 4

                    self.token_usage[call_type]['input_tokens'] += input_tokens
                    self.token_usage[call_type]['output_tokens'] += output_tokens

                    result = completion
                else:
                    kwargs.update(
                        {
                            'model': call_config.MODEL_NAME,
                            'messages': messages,
                            'response_format': schema,
                            'temperature': temperature,
                            'seed': seed,
                            'max_completion_tokens': max_tokens,
                        }
                    )

                    if call_config.MODEL_NAME in INCOMPATIBLE_ARGS:
                        for arg in INCOMPATIBLE_ARGS[call_config.MODEL_NAME]:
                            kwargs.pop(arg, None)

                    completion = await call_client.beta.chat.completions.parse(**kwargs)

                    from pathlib import Path
                    import time
                    import json

                    Path('./llm_messages').mkdir(exist_ok=True, parents=True)
                    with open(f'./llm_messages/{time.time()}.txt', 'w') as f:
                        for message in messages:
                            f.write(f'{message["role"]}: {message["content"]}\n')

                        f.write(
                            f'Response: {json.dumps(completion.choices[0].message.parsed.model_dump(), indent=4)}\n'
                        )

                    # Update token usage for OpenAI models
                    self.token_usage[call_type]['input_tokens'] += (
                        completion.usage.prompt_tokens
                    )
                    self.token_usage[call_type]['output_tokens'] += (
                        completion.usage.completion_tokens
                    )

                    result = completion.choices[0].message.parsed

            except Exception as e:
                if isinstance(e, openai.LengthFinishReasonError):
                    self.token_usage[call_type]['input_tokens'] += (
                        e.completion.usage.prompt_tokens
                    )
                    self.token_usage[call_type]['output_tokens'] += (
                        e.completion.usage.completion_tokens
                    )
                raise e

            if self.request_store_enabled:
                self.request_replayer.store(inputs, result)

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
        reasoning_input_cost = (
            reasoning_input_tokens / 1000
        ) * 0.0011  # Assuming different pricing
        reasoning_output_cost = (
            reasoning_output_tokens / 1000
        ) * 0.0044  # Adjust as per actual pricing

        total_cost = (
            generation_input_cost
            + generation_output_cost
            + reasoning_input_cost
            + reasoning_output_cost
        )
        return {
            'generation': {
                'input_tokens': generation_input_tokens,
                'output_tokens': generation_output_tokens,
                'input_cost': generation_input_cost,
                'output_cost': generation_output_cost,
            },
            'reasoning': {
                'input_tokens': reasoning_input_tokens,
                'output_tokens': reasoning_output_tokens,
                'input_cost': reasoning_input_cost,
                'output_cost': reasoning_output_cost,
            },
            'total_cost': total_cost,
        }
