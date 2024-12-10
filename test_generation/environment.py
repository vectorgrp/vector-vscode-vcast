from functools import cached_property
import os
import re
from typing import List, Optional
import subprocess
import tempfile
import sqlite3
import logging

class Environment:
    def __init__(self, env_file_path: str):
        self.env_file_path = env_file_path
        self.env_name = os.path.basename(env_file_path).replace('.env', '')

    def build(self):
        env_name = self.env_name
        env_dir = os.path.dirname(self.env_file_path)
        cmd = f'VCAST_FORCE_OVERWRITE_ENV_DIR=1 enviroedg {env_name}.env'
        env_vars = os.environ.copy()
        try:
            result = subprocess.run(cmd, shell=True, cwd=env_dir, env=env_vars,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
        except subprocess.TimeoutExpired:
            logging.error(f"Command '{cmd}' timed out after 30 seconds")
            return None
        
        logging.debug("Command: %s Return code: %s", cmd, result.returncode)
        
        if result.returncode != 0:
            error_msg = f"Build command '{cmd}' failed with error:\n{result.stderr or result.stdout}"
            raise RuntimeError(error_msg)

    def run_tests(self, test_cases: List[str], execute: bool = True, show_run_script_output: bool = False) -> Optional[str]:
        self.build()  # Build the environment before running tests
        
        with tempfile.NamedTemporaryFile(delete=False, suffix='.tst', mode='w') as temp_tst_file:
            tst_file_path = temp_tst_file.name
            temp_tst_file.write('-- VectorCAST 6.4s (05/01/17)\n')
            temp_tst_file.write('-- Test Case Script\n')
            temp_tst_file.write(f'-- Environment    : {self.env_name}\n')
            temp_tst_file.write(f'-- Unit(s) Under Test: {", ".join(self.units)}\n')
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

    @property
    def allowed_identifiers(self) -> List[str]:
        env_name = self.env_name
        env_dir = os.path.dirname(self.env_file_path)
        
        # Create a temporary file
        fd, tst_file_path = tempfile.mkstemp(suffix='.tst')
        os.close(fd)  # Close the file descriptor

        # Run the command to generate the test script template
        cmd = f'$VECTORCAST_DIR/clicast -e {env_name} test script template {tst_file_path}'
        env_vars = os.environ.copy()
        try:
            result = subprocess.run(cmd, shell=True, cwd=env_dir, env=env_vars,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
        except subprocess.TimeoutExpired:
            os.remove(tst_file_path)
            logging.error(f"Command '{cmd}' timed out after 30 seconds")
            return None
        
        if result.returncode != 0:
            os.remove(tst_file_path)
            error_msg = f"Command '{cmd}' failed with error:\n{result.stderr or result.stdout}"
            raise RuntimeError(error_msg)
        
        # Read the generated test script template
        with open(tst_file_path, 'r') as f:
            content = f.read()
        os.remove(tst_file_path)  # Clean up the temporary file

        # Extract identifiers from SCRIPT.VALUE and SCRIPT.EXPECTED lines
        identifiers = set()
        lines = content.splitlines()
        for line in lines:
            if line.startswith('TEST.VALUE') or line.startswith('TEST.EXPECTED'):
                identifier = line.split(':', 1)[1].rsplit(':', 1)[0]
                identifiers.add(identifier)
        return list(identifiers)

    @cached_property
    def source_files(self) -> List[str]:
        env_dir = os.path.dirname(self.env_file_path)
        db_path = os.path.join(env_dir, self.env_name, 'master.db')

        if not os.path.exists(db_path):
            raise FileNotFoundError(f"Database file '{db_path}' not found. Ensure the environment is built.")

        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        query = """
        SELECT path 
        FROM sourcefiles 
        WHERE path NOT LIKE '%vcast_preprocess%' 
          AND path NOT LIKE '%S0000008%' 
          AND (type = 'CPP_FILE' OR type = 'C_FILE');
        """

        cursor.execute(query)
        results = cursor.fetchall()

        conn.close()

        source_files = [row[0] for row in results]
        return source_files

    @cached_property
    def units(self) -> List[str]:
        source_files = self.source_files
        units = [os.path.splitext(os.path.basename(file))[0] for file in source_files]

        return units
            

    def _execute_commands(self, tst_file_path: str, show_run_script_output: bool) -> Optional[str]:
        env_name = self.env_name
        env_dir = os.path.dirname(self.env_file_path)
        
        commands = [
            f'$VECTORCAST_DIR/clicast -lc -e {env_name} Test Script Run {tst_file_path}',
            f'$VECTORCAST_DIR/clicast -lc -e {env_name} Execute All'
        ]
        output = ''
        env_vars = os.environ.copy()
        # Execute the commands using subprocess and capture the outputs
        for idx, cmd in enumerate(commands):
            try:
                result = subprocess.run(cmd, shell=True, cwd=env_dir, env=env_vars,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
            except subprocess.TimeoutExpired:
                logging.error(f"Command '{cmd}' timed out after 30 seconds")
                return None

            logging.debug("Command: %s Return code: %s", cmd, result.returncode)

            if show_run_script_output:
                logging.info("Command '%s' output:\n%s", cmd, result.stdout)

            output += result.stdout
            """
            if result.returncode != 0:
                # Handle errors if any command fails
                error_msg = f"Command '{cmd}' failed with error:\n{result.stderr or result.stdout}"
                raise RuntimeError(error_msg)
            """
        return output