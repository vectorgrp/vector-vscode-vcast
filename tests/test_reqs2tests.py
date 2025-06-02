import os
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest

from autoreq.reqs2tests import cli
from autoreq.test_generation.environment import Environment
from autoreq.replay import RequestReplay
from .utils import copy_folder


@pytest.mark.vcr
def test_batched_mode_no_reqs_keys(
    monkeypatch,
    envs_dir,
    test_output_recorder,
    mock_llm_client,
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

        cli()

        test_output_recorder.record_or_compare(
            'tests.tst', 'test_batched_mode_no_reqs_keys.tst'
        )

    os.chdir(current_workdir)


@pytest.mark.vcr
def test_no_decomposition_no_reqs_keys(
    monkeypatch,
    envs_dir,
    vectorcast_dir,
    test_output_recorder,
    mock_llm_client,
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

        cli()

        test_output_recorder.record_or_compare(
            'tests.tst', 'test_no_decomposition_no_reqs_keys.tst'
        )

    os.chdir(current_workdir)
