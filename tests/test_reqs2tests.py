import os
import json
import hashlib
import tempfile
import traceback
import typing as t
from pathlib import Path
from unittest.mock import patch, AsyncMock
from pydantic import create_model

from autoreq.reqs2tests import cli
from autoreq.test_generation.environment import Environment
from autoreq.test_generation.schema_builder import SchemaBuilder
from .utils import copy_folder


def _prop_to_type(prop: t.Dict, tc_model: t.Type) -> t.Type:
    if '$ref' in prop:
        return tc_model

    ty = prop.get('type')
    if ty == 'string':
        return str
    if ty == 'integer':
        return int
    if ty == 'number':
        return float
    if ty == 'boolean':
        return bool
    if ty == 'array':
        items = prop.get('items', {})
        item_py = _prop_to_type(items, tc_model)
        return t.List[item_py]
    raise ValueError(f'Unknown type {ty}')


def load_pydantic_from_saved(cache_data):
    schema_class, schema, result = (
        cache_data['schema_class'],
        cache_data['schema'],
        cache_data['result'],
    )
    result_data = json.loads(result)

    if schema_class == 'autoreq.test_generation.schema_builder.TestGenerationResult':
        sb = SchemaBuilder(None)
        tc = sb._derive_test_case_schema(None, None)
        model_fields = {
            name: (_prop_to_type(prop, tc), ...)
            for name, prop in schema['properties'].items()
        }
        TestGenerationResult = create_model('TestGenerationResult', **model_fields)
        return TestGenerationResult.model_validate(result_data)
    elif (
        schema_class
        == 'autoreq.test_generation.requirement_decomposition.RequirementDescription'
    ):
        from autoreq.test_generation.requirement_decomposition import (
            RequirementDescription,
        )

        return RequirementDescription.model_validate(result_data)

    raise NotImplementedError


def mock_call_model(
    messages,
    schema,
    temperature=0.0,
    max_tokens=5000,
    seed=42,
    extended_reasoning=False,
    **kwargs,
):
    llm_cache_dir = kwargs.pop('llm_cache_dir')

    inputs = {
        'messages': messages,
        'schema': str(schema),
        'temperature': temperature,
        'max_tokens': max_tokens,
        'seed': seed,
        'extended_reasoning': extended_reasoning,
        'additional_args': kwargs,
    }

    input_str = json.dumps(inputs, sort_keys=True)
    cache_key = hashlib.sha256(input_str.encode()).hexdigest()
    cache_file = llm_cache_dir / f'{cache_key}.json'

    if not cache_file.exists():
        raise FileNotFoundError(f'Cache file {cache_file} not found.')

    with open(cache_file, 'r') as f:
        cache_data = json.load(f)

    try:
        ret = load_pydantic_from_saved(cache_data)
    except Exception as e:
        traceback.print_exc()
        raise e
    return ret


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

        fake_call_model = AsyncMock(
            side_effect=lambda *args, **kwargs: mock_call_model(
                *args, **kwargs, llm_cache_dir=llm_cache_dir
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
        fake_call_model = AsyncMock(
            side_effect=lambda *args, **kwargs: mock_call_model(
                *args, **kwargs, llm_cache_dir=llm_cache_dir
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
