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
from dotenv import load_dotenv
from sys import exit

load_dotenv()

# TODO: Ensure we have json schemas for how providers need to be configured, perhaps using pydantic

RATE_LIMIT = AsyncLimiter(30, 60)
SUPPORTED_PROVIDERS = ("azure_openai", "ollama")
OPENAI_COMPATIBLE_PROVIDERS = ("ollama", "openai")

INCOMPATIBLE_ARGS = {
    "o3-mini": ["temperature", "max_completion_tokens"],
}

EXAMPLE_CONFIGS = {
    "mistral": {
        "PROVIDER": "ollama",
        "API_KEY": "none",
        "BASE_URL": "http://localhost:11434/v1/",
        "MODEL_NAME": "mistral",
    },
    "gpt-4o-azure": {
        "PROVIDER": "azure_openai",
        "API_KEY": "none",
        "API_VERSION": "2024-12-01-preview",
        "BASE_URL": "https://rg-example.openai.azure.com",
        "DEPLOYMENT": "gpt-4o-example",
        "MODEL_NAME": "gpt-4o",
    },
}


class Config:
    def __init__(self, config_name: str):
        self._model_files_dir = Path(os.getenv("REQ2TESTS_MODELS_PATH", Path.home() / ".req2tests-data" / "models"))

        if not self._model_files_dir.exists():
            logging.info(f"Creating config directory {self._model_files_dir}")
            os.makedirs(self._model_files_dir, exist_ok=True)
            logging.info("Generating config file templates")

            for _config_name, config_info in EXAMPLE_CONFIGS.items():
                config_path = self._model_files_dir / f"{_config_name}.yml"
                with open(config_path, "w") as f:
                    yaml.dump(config_info, f, default_flow_style=False)

            logging.error(f"""Created a new model directory in {self._model_files_dir}. Add your 
                            model.yml files there or set REQ2TEST_MODELS_PATH to point to an existing
                            folder with your model files.""")
            exit(1)

        logging.info(f"Loading config files from {self._model_files_dir}")

        available_models = [
            f.stem for f in self._model_files_dir.glob("*.yml")
        ]

        self._model_file = self._model_files_dir / f"{config_name}.yml"

        if not self._model_file.exists():
            logging.error(
                f"Config file {self._model_file} for model {config_name} not found. Available models: {available_models}"
            )

            exit(1)

        model_config = yaml.safe_load(self._model_file.read_text())

        assert 'PROVIDER' in model_config, (
            f"Config file {self._model_file} for model {config_name} does not contain a PROVIDER key."
        )

        # Now set the attributes
        for k, v in model_config.items():
            #setattr(self, k, os.getenv(k) or v or None)
            setattr(self, k, os.getenv(config_name.upper() + "_" + k) or v or None)

        assert self.PROVIDER in SUPPORTED_PROVIDERS, (
            f"Provider {self.provider} is not supported. List of supported providers: {SUPPORTED_PROVIDERS}"
        )

    def __getitem__(self, item):
        try:
            return getattr(self, item)
        except AttributeError as e:
            logging.error(
                f"Item {item} is expected to be in the config file for this provider."
            )
            raise e

    def __str__(self):
        return f"Config(provider={self.PROVIDER}, n_attributes={len(self.__dict__)})"


class LLMClient:
    def __init__(self, model_name: str = os.getenv("REQ2TESTS_MODEL", "gpt-4o-azure"), reasoning_model_name: str = os.getenv("REQ2TESTS_REASONING_MODEL", "gpt-o3mini-azure")):
        self.config = Config(model_name)
        self.reasoning_config = Config(reasoning_model_name)
        logging.info(f"Using config: {self.config}")
        logging.info(f"Using reasoning config: {self.reasoning_config}")

        self.token_usage = {
            "generation": {"input_tokens": 0, "output_tokens": 0},
            "reasoning": {"input_tokens": 0, "output_tokens": 0},
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
        if provider == "azure_openai":
            return AsyncAzureOpenAI(
                api_key=config.API_KEY,
                api_version=config.API_VERSION,
                azure_endpoint=config.BASE_URL,
                azure_deployment=config.DEPLOYMENT,
            )
        elif self._is_openai_compatible(provider):
            return AsyncOpenAI(
                api_key=config.API_KEY
                if (hasattr(config, "API_KEY") and config.API_KEY)
                else "none",
                base_url=config.BASE_URL,
            )
        else:
            raise NotImplementedError(f"Provider {provider} is not supported")

    def _is_openai_compatible(self, provider):
        return provider in OPENAI_COMPATIBLE_PROVIDERS

    exceptions = (
        openai.RateLimitError,
        openai.APITimeoutError,
        openai.APIConnectionError,
    )

    @backoff.on_exception(backoff.expo, exceptions, max_time=120)
    async def call_model(
        self,
        messages: t.List[t.Dict[str, str]],
        schema,
        temperature=0.0,
        max_tokens=5000,
        seed=42,
        extended_reasoning=False,
        return_raw_completion=False,
        **kwargs,
    ):
        async with RATE_LIMIT:
            try:
                call_config = self.config if not extended_reasoning else self.reasoning_config
                call_client = self.client if not extended_reasoning else self.reasoning_client
                call_type = "generation" if not extended_reasoning else "reasoning"

                #print(f"Calling {call_config.MODEL_NAME} with {call_type} model")

                kwargs.update(
                    {
                        "model": call_config.MODEL_NAME,
                        "messages": messages,
                        "response_format": schema,
                        "temperature": temperature,
                        "seed": seed,
                        "max_completion_tokens": max_tokens,
                    }
                )

                if call_config.MODEL_NAME in INCOMPATIBLE_ARGS:
                    for arg in INCOMPATIBLE_ARGS[call_config.MODEL_NAME]:
                        kwargs.pop(arg, None)
                
                completion = await call_client.beta.chat.completions.parse(**kwargs)

                # Update token usage for the generation model
                self.token_usage[call_type]["input_tokens"] += (
                    completion.usage.prompt_tokens
                )
                self.token_usage[call_type]["output_tokens"] += (
                    completion.usage.completion_tokens
                )
            except Exception as e:
                if isinstance(e, openai.LengthFinishReasonError):
                    self.token_usage[call_type]["input_tokens"] += (
                        e.completion.usage.prompt_tokens
                    )
                    self.token_usage[call_type]["output_tokens"] += (
                        e.completion.usage.completion_tokens
                    )
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
        generation_input_tokens = self.token_usage["generation"]["input_tokens"]
        generation_output_tokens = self.token_usage["generation"]["output_tokens"]
        reasoning_input_tokens = self.token_usage["reasoning"]["input_tokens"]
        reasoning_output_tokens = self.token_usage["reasoning"]["output_tokens"]

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
            "generation": {
                "input_tokens": generation_input_tokens,
                "output_tokens": generation_output_tokens,
                "input_cost": generation_input_cost,
                "output_cost": generation_output_cost,
            },
            "reasoning": {
                "input_tokens": reasoning_input_tokens,
                "output_tokens": reasoning_output_tokens,
                "input_cost": reasoning_input_cost,
                "output_cost": reasoning_output_cost,
            },
            "total_cost": total_cost,
        }
