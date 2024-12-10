# Project README

## Installation

To install the required dependencies, run the following command:

```sh
pip install -r requirements.txt
```

## Usage

### `code2reqs.py`

This script generates requirements for the functions in a given VectorCAST environment.

#### Command Line Arguments

- `env_path`: Path to the VectorCAST environment file.
- `--export-csv`: Path to the output CSV file for requirements.
- `--export-html`: Path to the output HTML file for pretty-printed requirements.
- `--export-repository`: Path to the VCAST_REPOSITORY for registering requirements.

#### Example

```sh
python code2reqs.py /path/to/vectorcast/environment.env --export-csv requirements.csv --export-html requirements.html --export-repository /path/to/requirements_repository
```

### `reqs2tests.py`

This script generates test cases for the given requirements in a VectorCAST environment.

#### Command Line Arguments

- `env_path`: Path to the VectorCAST environment file.
- `requirements_csv`: Path to the CSV file containing requirements.
- `requirement_ids`: ID of the requirement to generate test cases for (optional).
- `--execute`: Execute the generated test cases upon generation (output only visible if LOG_LEVEL is set to info).
- `--export-tst`: Path to a file to write the VectorCAST test cases.
- `--retries`: Number of retries for test generation (default: 3).
- `--extended_reasoning`: Use extended reasoning for test generation.

#### Example

```sh
python reqs2tests.py /path/to/vectorcast/environment.env requirements.csv --execute --export-tst test_cases.tst
```