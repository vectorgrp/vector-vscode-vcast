import os
import tempfile
from pathlib import Path

import pytest

from autoreq.code2reqs import cli
from .utils import copy_folder


@pytest.mark.vcr
def test_covered_lines_csv(
    monkeypatch,
    envs_dir,
    vectorcast_dir,
    mock_llm_client,
    requirements_output_recorder,
):
    current_workdir = os.getcwd()
    with tempfile.TemporaryDirectory() as out_folder:
        os.chdir(out_folder)

        copy_folder(envs_dir / 'TUTORIAL_C', Path(out_folder))
        test_args = [
            'code2reqs',
            './TUTORIAL_C.env',
            '--export-covered-lines',
            '--export-csv',
            'reqs.csv',
        ]
        monkeypatch.setattr('sys.argv', test_args)

        cli()

        requirements_output_recorder.record_or_compare('reqs.csv', 'reqs.csv')

    os.chdir(current_workdir)
