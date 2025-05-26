import os
import tarfile
import requests
from pathlib import Path

import pytest


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
