## Overview
This is a tool that helps organize and manage requirements. It extracts requirements, maps them to specific functions, and generates an Excel file for review and refinement. The script supports two modes of operation:
1. **Existing Requirements Gateway**: Use this mode if you have a pre-existing gateway (contains a `requirements.json` file). Only one environment per requirements gateway is supported for now.
2. **Initialize Requirements Gateway**: Automatically create a new gateway from your environment and a CSV template.

## How to Use
### 1. Prerequisites
Before using the script, ensure the following:
- You have `.env` files representing the environments.
- For initialization, a valid CSV template file is prepared.
- For existing setups, ensure the Requirements gateway is correctly initialised and the gateway folder contains a `requirements.json` file.
- You have installed VectorCAST and `clicast` in your environment (in a terminal window, type `clicast -v` to check).

### 2. Running the Tool
Use the following command to run the tool:
``` bash
reqs2excel <env_paths> [options]
```
#### Arguments:
- `env_paths`: Paths to `.env` files, or a file containing environment paths (you'll need to add the prefix `@` before the file path).

#### Options:
- `--requirements-gateway-path`: Path to a folder containing the `requirements.json` file (use this if not initializing requirements).
- `--output-file`: Path to save the generated Excel file (default: `requirements.xlsx`).
- `--init-requirements`: Initialize a gateway if none exists.
- `--csv-template`: Path to the CSV template file (required with `--init-requirements`).

## Examples
1. **Use Existing Requirements Gateway**:
``` bash
   reqs2excel env1.env --requirements-gateway-path /path/to/gateway --output-file output.xlsx
```
1. **Initialize New Gateway**:
``` bash
   reqs2excel env1.env --init-requirements --csv-template /path/to/template.csv --output-file output.xlsx
```
## Output
The script generates an Excel file with:
- **Requirements Table**: Lists all requirements, associated modules, and mapped functions.
- **Dropdown Selections**: Enables easy manual updating of modules and functions. Functions are linked to their respective modules.

The Excel file is suitable for being submitted to the executable `reqs2tests` tool as a regular source of requirements. 