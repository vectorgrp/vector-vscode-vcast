from functools import cached_property
from dataclasses import dataclass
import os
import re
from typing import List, Optional
import subprocess
import tempfile
import sqlite3
import logging
import charset_normalizer

from ..codebase import Codebase


@dataclass
class ValueMapping:
    identifier: str
    value: str

    def to_dict(self):
        return {
            "identifier": self.identifier,
            "value": self.value
        }

@dataclass
class TestCase:
    test_name: str
    test_description: str
    unit_name: str
    subprogram_name: str
    input_values: List[ValueMapping]
    expected_values: List[ValueMapping]
    requirement_id: Optional[str] = None

    @property
    def path(self) -> str:
        # Use regex to find lines containing (number) patterns
        path_pattern = re.compile(r'.*\(\d+\).*')
        path_lines = [line.split(')', 1)[1].strip() for line in self.test_description.split('\n')
                     if path_pattern.match(line)]
        return '\n'.join(path_lines)

    def to_dict(self):
        return {
            "test_name": self.test_name,
            "test_description": self.test_description,
            "unit_name": self.unit_name,
            "subprogram_name": self.subprogram_name,
            "input_values": [v.to_dict() for v in self.input_values],
            "expected_values": [v.to_dict() for v in self.expected_values],
            "requirement_id": self.requirement_id
        }

class Environment:
    def __init__(self, env_file_path: str, use_sandbox: bool = True):
        env_file_path = os.path.abspath(env_file_path)
        self.env_file_path = env_file_path
        self.env_name = os.path.basename(env_file_path).replace('.env', '')
        env_dir = os.path.dirname(env_file_path)
        if use_sandbox:
            import shutil
            self.temp_dir = tempfile.TemporaryDirectory()
            self.env_dir = self.temp_dir.name
            shutil.copytree(env_dir, self.env_dir, dirs_exist_ok=True)
        else:
            self.env_dir = env_dir
        self._tu_codebase_path = None

    def build(self):
        env_name = self.env_name
        cmd = f'VCAST_FORCE_OVERWRITE_ENV_DIR=1 $VECTORCAST_DIR/enviroedg {env_name}.env'
        env_vars = os.environ.copy()
        try:
            result = subprocess.run(cmd, shell=True, cwd=self.env_dir, env=env_vars,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
        except subprocess.TimeoutExpired:
            logging.error(f"Command '{cmd}' timed out after 30 seconds")
            return None
        
        logging.debug("Command: %s Return code: %s", cmd, result.returncode)
        
        if result.returncode != 0:
            error_msg = f"Build command '{cmd}' failed with error:\n{result.stderr or result.stdout}"
            raise RuntimeError(error_msg)


    def run_tests(self, test_cases: List[str], **kwargs) -> Optional[str]:
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

            output = self.run_test_script(tst_file_path, **kwargs)
            os.remove(tst_file_path)  # Clean up the temporary file

            return output


    def run_test_script(self, tst_file_path: str, rebuild: bool=True, with_coverage=False) -> Optional[str]:
        if rebuild:
            self.build()

        output = self._run_test_execute_commands(tst_file_path, with_coverage=with_coverage)
        return output

    @cached_property
    def allowed_identifiers(self) -> List[str]:
        env_name = self.env_name
        
        # Create a temporary file
        fd, tst_file_path = tempfile.mkstemp(suffix='.tst')
        os.close(fd)  # Close the file descriptor

        # Run the command to generate the test script template
        cmd = f'$VECTORCAST_DIR/clicast -e {env_name} test script template {tst_file_path}'
        env_vars = os.environ.copy()

        failed = False
        try:
            result = subprocess.run(cmd, shell=True, cwd=self.env_dir, env=env_vars,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
        except subprocess.TimeoutExpired:
            os.remove(tst_file_path)
            logging.error(f"Command '{cmd}' timed out after 30 seconds")
            failed = True
        
        if not failed:
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

            if len(identifiers) > 0:
                return list(identifiers)

            logging.warning("No identifiers found in the test script template")
            logging.warning("Falling back to scraping from ATG")
        else:
            logging.warning("Failed to generate test script template")
            logging.warning("Falling back to scraping from ATG")
        
        used_identifiers = set()
        for test in self.atg_tests:
            for value in test.input_values + test.expected_values:
                used_identifiers.add(value.identifier)
                
        return list(used_identifiers)

    def get_allowed_identifiers_for_function(self, function_name):
        all_identifiers = self.allowed_identifiers
        relevant_definitions = self.tu_codebase.find_definitions_by_name(function_name)

        relevant_identifiers = set()
        for identifier in all_identifiers:
            try:
                try:
                    unit, subprogram, entity = identifier.split('.')[:3]
                except:
                    logging.warning(f"Invalid identifier format: {identifier}")
                    relevant_identifiers.add(identifier)
                    continue

                subprogram = subprogram.split('::')[-1]  # Remove namespace if present
                entity = entity.split('[', 1)[0]  # Remove array index if present
                
                if unit == "USER_GLOBALS_VCAST":
                    relevant_identifiers.add(identifier)
                    continue

                if entity == '(cl)':
                    relevant_identifiers.add(identifier)
                    continue
                
                if subprogram == "<<GLOBAL>>":
                    search_term = entity
                else:
                    search_term = subprogram
                
                if any(search_term in defn for defn in relevant_definitions):
                    relevant_identifiers.add(identifier)
            except IndexError:
                logging.warning(f"Invalid identifier format: {identifier}")
                continue

        logging.debug(f"Found {len(relevant_identifiers)} relevant identifiers for function {function_name}")
        return list(relevant_identifiers)

    @cached_property
    def source_files(self) -> List[str]:
        db_path = os.path.join(self.env_dir, self.env_name, 'master.db')

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

    @cached_property
    def atg_tests(self) -> str:
        env_name = self.env_name
        # First try with baselining
        cmd = f'$VECTORCAST_DIR/atg -e {env_name} --baselining'
        env_vars = os.environ.copy()

        
        try:
            result = subprocess.run(cmd, shell=True, cwd=self.env_dir, env=env_vars,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            logging.warning(f"ATG with baselining timed out, trying without baselining")
            # Retry without baselining
            cmd = f'$VECTORCAST_DIR/atg -e {env_name}'
            try:
                result = subprocess.run(cmd, shell=True, cwd=self.env_dir, env=env_vars,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
            except subprocess.TimeoutExpired:
                logging.error(f"ATG command without baselining also timed out")
                return ""
            
        if result.returncode != 0:
            logging.error(f"ATG command failed with error:\n{result.stderr}")
            return ""
            
        atg_file = os.path.join(self.env_dir, 'atg.tst')
        if not os.path.exists(atg_file):
            logging.error("ATG file not generated")
            return ""
            
        return self._parse_test_script(atg_file)
        
    @cached_property
    def basis_path_tests(self) -> str:
        env_name = self.env_name
        cmd = f'$VECTORCAST_DIR/clicast -e {env_name} tool auto_test basis.tst'
        env_vars = os.environ.copy()
        
        try:
            result = subprocess.run(cmd, shell=True, cwd=self.env_dir, env=env_vars,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            logging.error(f"Command '{cmd}' timed out after 60 seconds")
            return ""
            
        if result.returncode != 0:
            logging.error(f"Basis path command failed with error:\n{result.stderr}")
            return ""
            
        basis_test_file = os.path.join(self.env_dir, 'basis.tst')
        if not os.path.exists(basis_test_file):
            logging.error("Basis path file not generated")
            return ""
            
        return self._parse_test_script(basis_test_file)

    @cached_property
    def tu_codebase(self):
        content = self.get_tu_content(reduction_level='medium')
        lines = content.splitlines()

        # CCLS cannot process files with more than 65535 lines, so split the file into chunks if necessary
        # This is a bit hacky but mostly fine for our needs. A more prinicpled approach would be a forked version of CCLS.
        # See: https://github.com/MaskRay/ccls/issues/366
        
        if len(lines) <= 65535:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.cpp', delete=False) as temp_file:
                temp_file.write(content)
                temp_file.flush()
                self._tu_codebase_path = temp_file.name
                return Codebase([temp_file.name])
        else:
            chunk_size = 65535
            chunk_files = []
            for i in range(0, len(lines), chunk_size):
                chunk_content = "\n".join(lines[i:i+chunk_size])
                with tempfile.NamedTemporaryFile(mode='w', suffix='.cpp', delete=False) as temp_file:
                    temp_file.write(chunk_content)
                    temp_file.flush()
                    chunk_files.append(temp_file.name)
            self._tu_codebase_path = chunk_files
            return Codebase(chunk_files)

    @cached_property
    def testable_functions(self):
        functions = self.tu_codebase.get_all_functions()

        reduced_content = self.get_tu_content(reduction_level='high')

        testable_functions = []
        for function in functions:
            if function['definition'] in reduced_content:
                testable_functions.append(function)

        if testable_functions:
            return testable_functions

        logging.warning("No testable functions found in the translation unit")
        logging.warning("Falling back to scraping from ATG")

        assert len(self.source_files) == 1

        tested_subprograms = {test.subprogram_name for test in self.atg_tests}

        return [
            {
                'name': subprogram,
                'file': self.source_files[0]
            }
            for subprogram in tested_subprograms
        ]


    def get_tu_content(self, reduction_level='medium'):
        """Get the content of the translation unit file.

        Args:
            reduction_level (str, optional): The level of reduction to apply to the translation unit content.
                The levels are:
                - low: The entire translation unit content is returned.
                - medium: Build-in definitions and declarations are removed.
                - high: Only the processed code from the actual source file is returned.

        Raises:
            FileNotFoundError: If the translation unit file is not found.

        Returns:
            str: The content of the translation unit file.
        """
        assert len(self.units) == len(self.source_files)
        assert len(self.units) == 1

        unit_name = self.units[0]
        unit_path = self.source_files[0]

        tu_path_c = os.path.join(self.env_dir, self.env_name, f"{unit_name}.tu.c")
        tu_path_cpp = os.path.join(self.env_dir, self.env_name, f"{unit_name}.tu.cpp")
        
        if os.path.exists(tu_path_c):
            tu_path = tu_path_c
        elif os.path.exists(tu_path_cpp):
            tu_path = tu_path_cpp
        else:
            raise FileNotFoundError(f"Translation unit file not found for {unit_name}")

        content = str(charset_normalizer.from_path(tu_path).best())

        if reduction_level == 'low':
            return content

        lines = content.splitlines()

        relevant_lines = []
        in_relevant_context = False
        marker_pattern = re.compile(r'^#\s+\d+\s+"(.+)"')

        for line in lines:
            stripped_line = line.strip()
            match = marker_pattern.match(stripped_line)
            if match:
                file_path_in_marker = os.path.abspath(match.group(1))

                if file_path_in_marker == unit_path:
                    in_relevant_context = True
                elif match.group(1).startswith("vcast_preprocess") or reduction_level == 'high':
                    in_relevant_context = False
            elif in_relevant_context:
                relevant_lines.append(line)

        relevant_content = "\n".join(relevant_lines)

        return relevant_content


    def _parse_test_script(self, tst_file_path: str) -> str:
        with open(tst_file_path, 'r') as f:
            content = f.readlines()

        test_cases = []
        current_test = None
        current_unit = None
        current_subprogram = None
        description_lines = []
        continue_reading = False

        for line in content:
            line = line.strip()
            
            # Skip empty lines and comments that don't start with TEST
            if not line or (line.startswith('--') and not line.startswith('TEST')):
                continue

            if line.startswith('TEST.UNIT:'):
                current_unit = line.split(':', 1)[1].strip()
            
            elif line.startswith('TEST.SUBPROGRAM:'):
                current_subprogram = line.split(':', 1)[1].strip()
            
            elif line.startswith('TEST.NAME:'):
                if current_test:
                    test_cases.append(current_test)
                
                test_name = line.split(':', 1)[1].strip()
                current_test = TestCase(
                    test_name=test_name,
                    test_description="",
                    unit_name=current_unit,
                    subprogram_name=current_subprogram,
                    input_values=[],
                    expected_values=[]
                )
            
            elif line.startswith('TEST.VALUE:'):
                if not current_test:
                    continue
                    
                _, rest = line.split(':', 1)
                identifier, value = rest.rsplit(':', 1)
                current_test.input_values.append(ValueMapping(
                    identifier=identifier.strip(),
                    value=value.strip()
                ))
            
            elif line.startswith('TEST.NOTES:'):
                if current_test:
                    description_lines = []
                    continue_reading = True
                    
            elif line.startswith('TEST.END_NOTES:'):
                if current_test and description_lines:
                    current_test.test_description = "\n".join(description_lines)
                continue_reading = False
            
            elif line.startswith('TEST.EXPECTED:'):
                if not current_test:
                    continue
                    
                _, rest = line.split(':', 1)
                identifier, value = rest.rsplit(':', 1)
                current_test.expected_values.append(ValueMapping(
                    identifier=identifier.strip(),
                    value=value.strip()
                ))

            elif continue_reading:
                description_lines.append(line)

            elif line.startswith('TEST.END'):
                if current_test:
                    test_cases.append(current_test)
                    current_test = None

        # Add the last test if exists
        if current_test:
            test_cases.append(current_test)
        return test_cases

    def _run_test_execute_commands(self, tst_file_path: str, with_coverage: bool = False) -> Optional[str]:
        env_name = self.env_name
        
        commands = [
            f'$VECTORCAST_DIR/clicast -lc -e {env_name} Test Script Run {tst_file_path}',
            f'$VECTORCAST_DIR/clicast -lc -e {env_name} Execute All'
        ]

        temp_coverage_file = tempfile.NamedTemporaryFile(delete=False, suffix='.txt', mode='w')

        if with_coverage:
            commands.append(f'$VECTORCAST_DIR/clicast -lc option VCAST_CUSTOM_REPORT_FORMAT TEXT')
            commands.append(f'$VECTORCAST_DIR/clicast -lc -e {env_name} report custom coverage {temp_coverage_file.name}')

        output = ''
        env_vars = os.environ.copy()
        # Execute the commands using subprocess and capture the outputs
        for idx, cmd in enumerate(commands):
            try:
                result = subprocess.run(cmd, shell=True, cwd=self.env_dir, env=env_vars,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
            except subprocess.TimeoutExpired:
                logging.error(f"Command '{cmd}' timed out after 30 seconds")
                return None

            logging.debug("Command '%s' output:\n%s", cmd, result.stdout)
            logging.debug("Command: %s Return code: %s", cmd, result.returncode)

            output += result.stdout

        if with_coverage:
            with open(temp_coverage_file.name, 'r') as f:
                coverage_output = f.read()

            coverage_data = {}
            match = re.search(r'GRAND TOTALS.* (\d+) \/ (\d+) .* (\d+) \/ (\d+) ', coverage_output)

            assert match, "Coverage data not found in the output"
            
            covered_statements, total_statements, covered_branches, total_branches = match.groups()
            coverage_data['statements'] = {
                'covered': int(covered_statements),
                'total': int(total_statements),
                'percentage': int(covered_statements) / int(total_statements)
            }
            coverage_data['branches'] = {
                'covered': int(covered_branches),
                'total': int(total_branches),
                'percentage': int(covered_branches) / int(total_branches)
            }
                
            output = (output, coverage_data)
            os.remove(temp_coverage_file.name)
            
        return output

    def cleanup(self):
        if self._tu_codebase_path:
            if isinstance(self._tu_codebase_path, list):
                for path in self._tu_codebase_path:
                    if os.path.exists(path):
                        os.remove(path)
            elif os.path.exists(self._tu_codebase_path):
                os.remove(self._tu_codebase_path)
        if hasattr(self, 'temp_dir'):
            self.temp_dir.cleanup()