import os

import pytest

from autoreq.panreq import cli
from autoreq.requirements_collection import (
    RequirementsCollection,
    Requirement,
    RequirementLocation,
)
from autoreq.test_generation.environment import Environment
from .utils import copy_folder


# Sample requirements for testing
SAMPLE_REQUIREMENTS = [
    {
        'key': 'REQ_001',
        'id': 'REQ_001',
        'title': 'Sample Requirement 1',
        'description': 'This is the first sample requirement for testing.',
        'unit': 'module1',
        'function': 'function1',
        'lines': [10, 11, 12],
    },
    {
        'key': 'REQ_002',
        'id': 'REQ_002',
        'title': 'Sample Requirement 2',
        'description': 'This is the second sample requirement for testing.',
        'unit': 'module2',
        'function': 'function2',
        'lines': [20, 21],
    },
    {
        'key': 'REQ_003',
        'id': 'REQ_003',
        'title': 'Sample Requirement 3',
        'description': 'This is the third sample requirement for testing.',
        'unit': None,
        'function': None,
        'lines': None,
    },
]


@pytest.fixture
def sample_requirements():
    """Create a sample RequirementsCollection for testing."""
    requirements = []
    for req_data in SAMPLE_REQUIREMENTS:
        req = Requirement(
            key=req_data['key'],
            id=req_data['id'],
            title=req_data['title'],
            description=req_data['description'],
            location=RequirementLocation(
                unit=req_data['unit'],
                function=req_data['function'],
                lines=req_data['lines'],
            ),
        )
        requirements.append(req)
    return RequirementsCollection(requirements)


@pytest.fixture
def sample_csv_file(tmp_path, sample_requirements):
    """Create a sample CSV file for testing."""
    csv_path = str(tmp_path / 'sample_requirements.csv')
    sample_requirements.to_csv(csv_path)
    return csv_path


@pytest.fixture
def sample_excel_file(tmp_path, sample_requirements):
    """Create a sample Excel file for testing."""
    excel_path = str(tmp_path / 'sample_requirements.xlsx')
    sample_requirements.to_excel(excel_path)
    return excel_path


# Basic format conversion tests (no VCR needed)


def test_csv_to_excel_conversion(
    monkeypatch,
    tmp_path,
    sample_csv_file,
    requirements_output_recorder,
):
    """Test conversion from CSV to Excel format."""
    current_workdir = os.getcwd()
    try:
        os.chdir(tmp_path)

        output_path = tmp_path / 'output.xlsx'
        test_args = [
            'panreq',
            str(sample_csv_file),
            str(output_path),
            '--target-format',
            'excel',
        ]
        monkeypatch.setattr('sys.argv', test_args)

        cli()

        assert output_path.exists()
        requirements_output_recorder.record_or_compare(
            str(output_path), 'csv_to_excel.xlsx'
        )
    finally:
        os.chdir(current_workdir)


def test_excel_to_csv_conversion(
    monkeypatch,
    tmp_path,
    sample_excel_file,
    requirements_output_recorder,
):
    """Test conversion from Excel to CSV format."""
    current_workdir = os.getcwd()
    try:
        os.chdir(tmp_path)

        output_path = str(tmp_path / 'output.csv')
        test_args = [
            'panreq',
            str(sample_excel_file),
            output_path,
            '--target-format',
            'csv',
        ]
        monkeypatch.setattr('sys.argv', test_args)

        cli()

        requirements_output_recorder.record_or_compare(output_path, 'excel_to_csv.csv')
    finally:
        os.chdir(current_workdir)


# Traceability inference test (VCR needed due to LLM calls)


@pytest.mark.vcr
def test_csv_to_excel_with_traceability(
    monkeypatch,
    envs_dir,
    vectorcast_dir,
    mock_llm_client,
    tmp_path,
    sample_csv_file,
    requirements_output_recorder,
):
    """Test CSV to Excel conversion with traceability inference."""
    current_workdir = os.getcwd()
    env = None
    try:
        os.chdir(tmp_path)

        # Copy a test environment
        copy_folder(envs_dir / 'TUTORIAL_C', tmp_path)
        env_path = str(tmp_path / 'TUTORIAL_C.env')

        env = Environment(env_path, use_sandbox=False)
        env.build()

        output_path = str(tmp_path / 'output_with_traceability.xlsx')
        test_args = [
            'panreq',
            sample_csv_file,
            output_path,
            '--target-format',
            'excel',
            '--target-env',
            str(env_path),
            '--infer-traceability',
        ]
        monkeypatch.setattr('sys.argv', test_args)

        cli()

        requirements_output_recorder.record_or_compare(
            output_path, 'csv_to_excel_with_traceability.xlsx'
        )
    finally:
        os.chdir(current_workdir)
        env.cleanup()


# Round-trip equivalence tests (property-style without framework)


def test_csv_round_trip_equivalence(tmp_path, sample_requirements):
    """Test that requirements survive a round trip through CSV format."""
    # Save to CSV
    csv_path = tmp_path / 'test.csv'
    sample_requirements.to_csv(csv_path)

    # Load from CSV
    loaded_collection = RequirementsCollection.from_csv(csv_path)

    # Compare
    assert len(sample_requirements) == len(loaded_collection)

    for orig_req, loaded_req in zip(sample_requirements, loaded_collection):
        assert orig_req.key == loaded_req.key
        assert orig_req.id == loaded_req.id
        assert orig_req.title == loaded_req.title
        assert orig_req.description == loaded_req.description
        assert orig_req.location.unit == loaded_req.location.unit
        assert orig_req.location.function == loaded_req.location.function


def test_excel_round_trip_equivalence(tmp_path, sample_requirements):
    """Test that requirements survive a round trip through Excel format."""
    # Save to Excel
    excel_path = str(tmp_path / 'test.xlsx')
    sample_requirements.to_excel(excel_path)

    # Load from Excel
    loaded_collection = RequirementsCollection.from_excel(excel_path)

    # Compare
    assert len(sample_requirements) == len(loaded_collection)

    for orig_req, loaded_req in zip(sample_requirements, loaded_collection):
        assert orig_req.key == loaded_req.key
        assert orig_req.id == loaded_req.id
        assert orig_req.title == loaded_req.title
        assert orig_req.description == loaded_req.description


def test_csv_excel_round_trip(tmp_path, sample_requirements):
    """Test CSV -> Excel -> CSV round trip."""
    # CSV -> Excel
    csv_path1 = str(tmp_path / 'test1.csv')
    excel_path = str(tmp_path / 'test.xlsx')
    sample_requirements.to_csv(csv_path1)

    loaded_from_csv = RequirementsCollection.from_csv(csv_path1)
    loaded_from_csv.to_excel(excel_path)

    # Excel -> CSV
    csv_path2 = tmp_path / 'test2.csv'
    loaded_from_excel = RequirementsCollection.from_excel(excel_path)
    loaded_from_excel.to_csv(csv_path2)

    # Load final result
    final_collection = RequirementsCollection.from_csv(csv_path2)

    # Compare key fields
    assert len(sample_requirements) == len(final_collection)

    for orig_req, final_req in zip(sample_requirements, final_collection):
        assert orig_req.key == final_req.key
        assert orig_req.id == final_req.id
        assert orig_req.title == final_req.title
        assert orig_req.description == final_req.description


# Error handling tests


def test_missing_target_env_for_traceability(monkeypatch, tmp_path, sample_csv_file):
    """Test that an error is raised when traceability is requested without target environment."""
    current_workdir = os.getcwd()
    try:
        os.chdir(tmp_path)

        output_path = tmp_path / 'output.xlsx'
        test_args = [
            'panreq',
            str(sample_csv_file),
            str(output_path),
            '--target-format',
            'excel',
            '--infer-traceability',
        ]
        monkeypatch.setattr('sys.argv', test_args)

        # The ValueError should be raised directly by asyncio.run()
        with pytest.raises(
            ValueError,
            match='When inferring traceability, a target environment must be provided',
        ):
            cli()
    finally:
        os.chdir(current_workdir)


def test_invalid_target_format(monkeypatch, tmp_path, sample_csv_file):
    """Test that an error is raised for invalid target format."""
    current_workdir = os.getcwd()
    try:
        os.chdir(tmp_path)

        output_path = tmp_path / 'output.txt'
        test_args = [
            'panreq',
            str(sample_csv_file),
            str(output_path),
            '--target-format',
            'invalid',
        ]
        monkeypatch.setattr('sys.argv', test_args)

        with pytest.raises(SystemExit):
            cli()
    finally:
        os.chdir(current_workdir)
