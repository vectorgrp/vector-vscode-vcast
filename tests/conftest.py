import json
import os
import tarfile
import requests
import difflib
from pathlib import Path
from unittest.mock import patch, MagicMock


import pytest

from autoreq.llm_client import LLMClient


class BaseFileRecorder:
    """Base class for recording and comparing test output files."""

    def __init__(self, recording_mode, test_name):
        self.recording_mode = recording_mode
        self.test_name = test_name
        self.test_dir = Path(__file__).parent / 'test_outputs' / test_name
        self.test_dir.mkdir(parents=True, exist_ok=True)

    def record_or_compare(
        self, actual_file_path: str, expected_filename: str = 'expected_output'
    ):
        """Record the output file or compare it against the expected one."""
        expected_path = self.test_dir / expected_filename

        if self.recording_mode or not expected_path.exists():
            # Record mode: save the actual output as expected
            import shutil

            shutil.copy2(actual_file_path, expected_path)
            print(f'Recorded test output to {expected_path}')
            return True
        else:
            # Replay mode: compare actual vs expected
            return self._compare_files(actual_file_path, str(expected_path))

    def _compare_files(self, actual_path: str, expected_path: str):
        """Override this method in subclasses to implement specific comparison logic."""
        raise NotImplementedError('Subclasses must implement _compare_files method')


class GenericFileRecorder(BaseFileRecorder):
    """Generic recorder for text files."""

    def _compare_files(self, actual_path: str, expected_path: str):
        """Compare text files line by line."""
        with open(actual_path, 'r', encoding='utf-8') as actual_file:
            actual_lines = actual_file.readlines()

        with open(expected_path, 'r', encoding='utf-8') as expected_file:
            expected_lines = expected_file.readlines()

        diff = difflib.unified_diff(
            expected_lines,
            actual_lines,
            lineterm='',
            fromfile='expected',
            tofile='actual',
        )

        diff_output = '\n'.join(diff)
        if diff_output:
            print(f'Differences found:\n{diff_output}')
            return False

        return True


class TestFileRecorder(BaseFileRecorder):
    """Recorder specifically for .tst test files."""

    def _compare_files(self, actual_path: str, expected_path: str):
        """Compare test files using Environment.parse_test_script."""
        from autoreq.test_generation.environment import Environment
        import json

        try:
            expected = [
                tc.to_dict() for tc in Environment.parse_test_script(expected_path)
            ]
            actual = [tc.to_dict() for tc in Environment.parse_test_script(actual_path)]

            assert len(actual) > 0, 'No test cases were generated'
            assert len(actual) == len(expected), (
                f'Expected {len(expected)} test cases, but got {len(actual)}'
            )

            for a, e in zip(
                sorted(actual, key=lambda x: x['test_name']),
                sorted(expected, key=lambda x: x['test_name']),
            ):
                print(json.dumps(a, sort_keys=True, indent=4))
                print(json.dumps(e, sort_keys=True, indent=4))
                print('=====')
                assert json.dumps(a, sort_keys=True) == json.dumps(e, sort_keys=True), (
                    f'Expected {json.dumps(e, sort_keys=True)} but got {json.dumps(a, sort_keys=True)}'
                )

            return True
        except Exception as e:
            # If comparison fails, optionally record in case of updates
            if self.recording_mode:
                import shutil

                shutil.copy2(actual_path, str(Path(expected_path)))
                print(f'Updated recorded test output at {expected_path}')
                return True
            else:
                raise e


class RequirementsFileRecorder(BaseFileRecorder):
    """Recorder specifically for requirements files."""

    def _compare_files(self, actual_path: str, expected_path: str):
        """Compare requirements files line by line."""
        assert actual_path.endswith('.csv') and expected_path.endswith('.csv'), (
            'Both actual and expected paths must be CSV files.'
        )

        import pandas as pd

        actual_df = pd.read_csv(actual_path)
        expected_df = pd.read_csv(expected_path)
        for (k1, v1), (k2, v2) in zip(
            actual_df.to_dict().items(), expected_df.to_dict().items()
        ):
            assert k1 == k2, f'Column names do not match: {k1} != {k2}'
            sorted_v1 = sorted(v1.values())
            sorted_v2 = sorted(v2.values())
            assert sorted_v1 == sorted_v2, (
                f'Column values do not match for {k1}: {sorted_v1} != {sorted_v2}'
            )


@pytest.fixture
def mock_llm_client(recording_mode):
    """Mock LLMClient initialization with default mock configs when not recording."""
    if recording_mode:
        # Validate that only approved models are used during recording
        llm_client = LLMClient()
        model_name = llm_client.config.MODEL_NAME
        reasoning_model_name = llm_client.reasoning_config.MODEL_NAME

        # Extract the actual model names from config names
        approved_models = {'gpt-4.1'}
        approved_reasoning_models = {'o4-mini'}

        # Check main model
        if not any(approved in model_name for approved in approved_models):
            raise ValueError(
                f'Recording mode only allows gpt-4.1.'
                f'Current model: {model_name}. '
                f"Please set REQ2TESTS_MODEL to a config containing 'gpt-4.1'."
            )

        # Check reasoning model
        if not any(
            approved in reasoning_model_name for approved in approved_reasoning_models
        ):
            raise ValueError(
                f'Recording mode only allows o4-mini. '
                f'Current reasoning model: {reasoning_model_name}. '
                f"Please set REQ2TESTS_REASONING_MODEL to a config containing 'o4mini'."
            )

        # Don't mock when recording - allow real LLM client to work
        yield None
        return

    def llm_init_side_effect(self, *args, **kwargs):
        # Mock configs
        mock_config = MagicMock()
        mock_config.PROVIDER = 'azure_openai'
        mock_config.MODEL_NAME = 'gpt-4.1'
        mock_config.API_KEY = 'mock-api-key'
        mock_config.API_VERSION = '2024-12-01-preview'
        mock_config.BASE_URL = 'https://mock.openai.azure.com'
        mock_config.DEPLOYMENT = 'mock-deployment'

        mock_reasoning_config = MagicMock()
        mock_reasoning_config.PROVIDER = 'azure_openai'
        mock_reasoning_config.MODEL_NAME = 'o4-mini'
        mock_reasoning_config.API_KEY = 'mock-reasoning-api-key'
        mock_reasoning_config.API_VERSION = '2024-12-01-preview'
        mock_reasoning_config.BASE_URL = 'https://mock-reasoning.openai.azure.com'
        mock_reasoning_config.DEPLOYMENT = 'mock-reasoning-deployment'

        self.config = mock_config
        self.reasoning_config = mock_reasoning_config

        # Mock token usage
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

    with patch('autoreq.llm_client.LLMClient.__init__', new=llm_init_side_effect):
        yield None


def pytest_addoption(parser):
    """Add command line option for recording mode."""
    parser.addoption(
        '--record',
        action='store_true',
        default=False,
        help='Enable recording mode for both pytest-recording and test output files',
    )


def pytest_configure(config):
    """Configure pytest based on command line options."""
    if config.getoption('--record'):
        # Set record mode to 'rewrite' for pytest-recording
        config.option.record_mode = 'rewrite'


@pytest.fixture
def envs_dir():
    return Path(__file__).parent / 'envs_for_tests'


@pytest.fixture
def real_requirements_dir(envs_dir):
    return envs_dir / 'requirements_gateway'


@pytest.fixture
def llm_cache_dir():
    return Path(__file__).parent / 'llm_cache'


@pytest.fixture
def vectorcast_dir():
    _vectorcast_dir = os.getenv('VECTORCAST_DIR')
    assert _vectorcast_dir
    _vectorcast_dir = Path(_vectorcast_dir)
    assert _vectorcast_dir.is_dir(), (
        'VectorCast directory should be set in VECTORCAST_DIR environment variable.'
    )
    return _vectorcast_dir


@pytest.fixture(scope='session', autouse=True)
def download_and_extract_all(tmp_path_factory):
    print('Downloading and extracting all required files...')

    artifacts_base_url = 'https://artifactory.vi.vector.int:443/artifactory/rds-build-packages-generic-dev-local/code2reqs2tests/pytest-artifacts'
    tar_urls = {
        'envs_for_tests': f'{artifacts_base_url}/envs_for_tests.tar.gz',
        'llm_cache': f'{artifacts_base_url}/llm_cache.tar.gz',
    }
    tmp = tmp_path_factory.mktemp('downloaded_tars')
    script_directory = os.path.dirname(os.path.abspath(__file__))

    for name, url in tar_urls.items():
        tar_file = Path(tmp, f'{name}.tar.gz')
        target_folder = Path(script_directory, name)
        if target_folder.exists():
            print(f'Folder {target_folder} already exists. Skipping download.')
            continue

        resp = requests.get(url)
        tar_file.write_bytes(resp.content)

        with tarfile.open(tar_file) as tf:
            tf.extractall(path=target_folder)

    print('Done.')


@pytest.fixture(scope='session')
def vcr_config():
    return {
        'before_record_request': _prepare_request_for_storage,
        #'match_on': ['method', 'scheme', 'host', 'port', 'path', 'query', 'raw_body'],
        # TODO: Ignore the actual URL for now as different users might have different models configured by default
        # TODO: This implictly also assumes that we only send model requests, which is true for now but not generally
        # TODO: This also assumes that we never send the same request to different models, which is also true for now
        # TODO: A better way to deal with this (also to allow more general models) is to detect which deployments/models are used during recording and always preprocess the request to replace those by consistent placeholders
        'match_on': ['method', 'scheme', 'query', 'raw_body'],
    }


def _prepare_request_for_storage(request):
    if 'authorization' in request.headers:
        request.headers['authorization'] = 'REDACTED'
    if 'api-key' in request.headers:
        request.headers['api-key'] = 'REDACTED'
    if 'host' in request.headers:
        request.headers['host'] = 'REDACTED'

    try:
        body = json.loads(request.body)

        if 'response_format' in body:
            body['response_format'] = _normalize_schema_names(body['response_format'])

        request.body = json.dumps(body, sort_keys=True)
    except Exception:
        # If body is not JSON, we leave it as is (this should never happen)
        pass

    return request


def _normalize_schema_names(schema):
    if isinstance(schema, dict):
        return {
            _normalize_schema_names(k): _normalize_schema_names(v)
            for k, v in schema.items()
        }
    elif isinstance(schema, list):
        return [_normalize_schema_names(item) for item in schema]
    elif isinstance(schema, str):
        parts = schema.split('_')

        if parts[-1].isdigit():
            return '_'.join(parts[:-1])
        return schema
    else:
        return schema


@pytest.fixture
def recording_mode(request):
    """Determine if we should record new test outputs or compare against existing ones."""
    return request.config.getoption('--record', default=False)


@pytest.fixture
def test_output_recorder(recording_mode, request):
    """Fixture to handle recording and replaying of test output files."""
    return TestFileRecorder(recording_mode, request.node.name)


@pytest.fixture
def requirements_output_recorder(recording_mode, request):
    """Fixture to handle recording and replaying of requirements output files."""
    return RequirementsFileRecorder(recording_mode, request.node.name)


@pytest.fixture
def generic_output_recorder(recording_mode, request):
    """Fixture to handle recording and replaying of generic text output files."""
    return GenericFileRecorder(recording_mode, request.node.name)
