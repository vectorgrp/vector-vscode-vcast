import os
import re
from typing import List, Optional
import subprocess  # Add import to use subprocess
import tempfile  # Add import to use tempfile

class TestEnvironmentManager:
    def __init__(self, envs_path: str):
        self.envs_path = envs_path
        self.environments = self._collect_environments()

    def _collect_environments(self) -> List[str]:
        environments = []
        for root, _, files in os.walk(self.envs_path):
            for file in files:
                if file.endswith('.env'):
                    env_file_path = os.path.join(root, file)
                    environments.append(env_file_path)
        return environments

    def get_environment(self, unit_names: List[str]):
        for env_file in self.environments:
            if self._environment_matches(env_file, unit_names):
                return Environment(env_file)
        return None

    def _environment_matches(self, env_file: str, unit_names: List[str]) -> bool:
        with open(env_file, 'r') as f:
            content = f.read()
        stub_by_functions = re.findall(r'ENVIRO\.STUB_BY_FUNCTION:(\w+)', content)
        return all(unit_name in stub_by_functions for unit_name in unit_names)

class Environment:
    def __init__(self, env_file_path: str):
        self.env_file_path = env_file_path
        self.env_name = os.path.basename(env_file_path).replace('.env', '')

    def run_tests(self, test_cases: List[str], execute: bool = True, show_run_script_output: bool = False) -> Optional[str]:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.tst', mode='w') as temp_tst_file:
            tst_file_path = temp_tst_file.name
            temp_tst_file.write('-- VectorCAST 6.4s (05/01/17)\n')
            temp_tst_file.write('-- Test Case Script\n')
            temp_tst_file.write(f'-- Environment    : {self.env_name}\n')
            temp_tst_file.write(f'-- Unit(s) Under Test: {", ".join(self._get_units())}\n')
            temp_tst_file.write('-- \n')
            temp_tst_file.write('-- Script Features\n')
            temp_tst_file.write('TEST.SCRIPT_FEATURE:C_DIRECT_ARRAY_INDEXING\n')
            temp_tst_file.write('TEST.SCRIPT_FEATURE:CPP_CLASS_OBJECT_REVISION\n')
            temp_tst_file.write('TEST.SCRIPT_FEATURE:MULTIPLE_UUT_SUPPORT\n')
            temp_tst_file.write('TEST.SCRIPT_FEATURE:MIXED_CASE_NAMES\n')
            temp_tst_file.write('TEST.SCRIPT_FEATURE:STATIC_HEADER_FUNCS_IN_UUTS\n')
            temp_tst_file.write('--\n\n')
            for test_case in test_cases:
                temp_tst_file.write(test_case + '\n')

            temp_tst_file.flush()

            if execute:
                output = self._execute_commands(tst_file_path, show_run_script_output)
                os.remove(tst_file_path)  # Clean up the temporary file
                return output

        return None

    def _get_units(self) -> List[str]:
        with open(self.env_file_path, 'r') as f:
            content = f.read()
        units = re.findall(r'ENVIRO\.STUB_BY_FUNCTION:(\w+)', content)
        return units

    def _execute_commands(self, tst_file_path: str, show_run_script_output: bool) -> str:
        env_name = self.env_name
        env_dir = os.path.dirname(self.env_file_path)
        commands = [
            f'VCAST_FORCE_OVERWRITE_ENV_DIR=1 enviroedg {env_name}.env',
            f'clicast -lc -e {env_name} Test Script Run {tst_file_path}',
            f'clicast -lc -e {env_name} Execute All'
        ]
        output = ''
        env_vars = os.environ.copy()
        # Execute the commands using subprocess and capture the outputs
        for idx, cmd in enumerate(commands):
            result = subprocess.run(cmd, shell=True, cwd=env_dir, env=env_vars, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

            print("Command:", cmd, "Return code:", result.returncode)

            if idx > 0:
                if show_run_script_output:
                    print(f"Command '{cmd}' output:")
                    print(result.stdout)

                output += result.stdout
            """
            if result.returncode != 0:
                # Handle errors if any command fails
                error_msg = f"Command '{cmd}' failed with error:\n{result.stderr or result.stdout}"
                raise RuntimeError(error_msg)
            """
        return output