import os
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, AsyncMock

from autoreq.reqs2tests import cli
from autoreq.test_generation.environment import Environment
from autoreq.replay import RequestReplay
from .utils import copy_folder


def mock_call_model_with_replay(
    replay_instance,
    messages,
    schema,
    temperature=0.0,
    max_tokens=5000,
    seed=42,
    extended_reasoning=False,
    **kwargs,
):
    # Create inputs signature for replay
    inputs = {
        'messages': messages,
        'schema': schema,
        'temperature': temperature,
        'max_tokens': max_tokens,
        'seed': seed,
        'extended_reasoning': extended_reasoning,
        'additional_args': kwargs,
    }

    # Use the shared RequestReplay instance to get cached response
    result = replay_instance.replay(inputs)

    if result is None:
        raise FileNotFoundError('No cached response found for inputs')

    return result


def llm_init_side_effect(self, *args, **kwargs):
    self.token_usage = {
        'generation': {
            'input_tokens': 0,
            'output_tokens': 0,
            'input_cost': 0,
            'output_cost': 0,
        },
        'reasoning': {
            'input_tokens': 0,
            'output_tokens': 0,
            'input_cost': 0,
            'output_cost': 0,
        },
        'total_cost': 0,
    }


def compare_tests(expected_path: str, actual_path: str):
    expected = [tc.to_dict() for tc in Environment.parse_test_script(expected_path)]
    actual = [tc.to_dict() for tc in Environment.parse_test_script(actual_path)]

    assert len(actual) == len(expected), (
        f'Expected {len(expected)} test cases, but got {len(actual)}'
    )

    for a, e in zip(
        sorted(actual, key=lambda x: x['test_name']),
        sorted(expected, key=lambda x: x['test_name']),
    ):
        assert json.dumps(a, sort_keys=True) == json.dumps(e, sort_keys=True), (
            f'Expected {json.dumps(e, sort_keys=True)} but got {json.dumps(a, sort_keys=True)}'
        )


def test_batched_mode_no_reqs_keys(
    monkeypatch, envs_dir, vectorcast_dir, llm_cache_dir
):
    current_workdir = os.getcwd()
    with tempfile.TemporaryDirectory() as out_folder:
        os.chdir(out_folder)
        copy_folder(envs_dir / 'TUTORIAL_C', Path(out_folder))
        test_args = [
            'reqs2tests',
            './TUTORIAL_C.env',
            './reqs.xlsx',
            '--batched',
            '--no-requirement-keys',
            '--export-tst',
            'tests.tst',
        ]
        monkeypatch.setattr('sys.argv', test_args)

        # Create a single RequestReplay instance to preserve state
        replay_instance = RequestReplay(llm_cache_dir)

        fake_call_model = AsyncMock(
            side_effect=lambda *args, **kwargs: mock_call_model_with_replay(
                replay_instance, *args, **kwargs
            )
        )
        with (
            patch('autoreq.llm_client.LLMClient.__init__', new=llm_init_side_effect),
            patch('autoreq.llm_client.LLMClient.call_model', new=fake_call_model),
        ):
            cli()

        compare_tests(
            str(envs_dir / 'TUTORIAL_C' / 'test_batched_mode_no_reqs_keys.tst'),
            'tests.tst',
        )

    os.chdir(current_workdir)


def test_no_decomposition_no_reqs_keys(
    monkeypatch, envs_dir, vectorcast_dir, llm_cache_dir
):
    current_workdir = os.getcwd()
    with tempfile.TemporaryDirectory() as out_folder:
        copy_folder(envs_dir / 'TUTORIAL_C', Path(out_folder))
        os.chdir(out_folder)
        test_args = [
            'reqs2tests',
            './TUTORIAL_C.env',
            './perfect_reqs.csv',
            'Add_Included_Dessert.2',
            '--export-tst',
            'tests.tst',
            '--no-requirement-keys',
            '--no-decomposition',
            '--retries',
            '1',
        ]
        monkeypatch.setattr('sys.argv', test_args)

        # Create a single RequestReplay instance to preserve state
        replay_instance = RequestReplay(llm_cache_dir)

        fake_call_model = AsyncMock(
            side_effect=lambda *args, **kwargs: mock_call_model_with_replay(
                replay_instance, *args, **kwargs
            )
        )
        with (
            patch('autoreq.llm_client.LLMClient.__init__', new=llm_init_side_effect),
            patch('autoreq.llm_client.LLMClient.call_model', new=fake_call_model),
        ):
            cli()

        compare_tests(
            str(envs_dir / 'TUTORIAL_C' / 'test_no_decomposition_no_reqs_keys.tst'),
            'tests.tst',
        )

    os.chdir(current_workdir)
