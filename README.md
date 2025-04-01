# Project README

## Installation

To install the required dependencies, run the following command:

```sh
pip install --editable .
```


## Usage

### LLM provider configuration

Make sure that `REQ2TEST_CONFIG` points to a folder with one or more YAML files containing LLM configurations.
This is an example for AzureOpenAI:
```yaml 
# azure_openai.yml
API_KEY: "key"
API_VERSION: "2024-08-01-preview"
BASE_URL: "https://rg-example.openai.azure.com"
DEPLOYMENT: "gpt-4o-example"
MODEL_NAME: "gpt-4o"
```
This is an example for ollama:
```yaml 
#ollama.yml
API_KEY: "key"
BASE_URL: "http://localhost:11434/v1/"
MODEL_NAME: "mistral"
```

Set `LLM_PROVIDER` to be the same as the filename of the configuration you would like to use. Per default, `LLM_PROVIDER` is set to `azure_openai`.

If you do not set `REQ2TEST_CONFIG`, a configuration folder `.req2test-data/.config` will be automatically created in your HOME directory (under `/home/username` on Linux and under `C:\Users\username` on Windows) and populated with the template files above.
### `code2reqs`

This script generates requirements for the functions in a given VectorCAST environment.

#### Command Line Arguments

- `env_path`: Path to the VectorCAST environment file.
- `--export-csv`: Path to the output CSV file for requirements.
- `--export-html`: Path to the output HTML file for pretty-printed requirements.
- `--export-repository`: Path to the VCAST_REPOSITORY for registering requirements.

#### Example

```sh
code2reqs /path/to/vectorcast/environment.env --export-csv requirements.csv --export-html requirements.html --export-repository /path/to/requirements_repository
```

### `reqs2tests`

This script generates test cases for the given requirements in a VectorCAST environment.

#### Command Line Arguments

- `env_path`: Path to the VectorCAST environment file.
- `requirements_csv`: Path to the CSV file containing requirements.
- `requirement_ids`: ID of the requirement to generate test cases for (optional).
- `--execute`: Execute the generated test cases upon generation (output only visible if LOG_LEVEL is set to info).
- `--export-tst`: Path to a file to write the VectorCAST test cases.
- `--retries`: Number of retries for test generation (default: 3).
- `--extended_reasoning`: Use extended reasoning for test generation.
- `--export-env`: Add generated tests to environment

#### Example

```sh
reqs2tests /path/to/vectorcast/environment.env requirements.csv --execute --export-tst test_cases.tst
```