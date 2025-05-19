from functools import cached_property, lru_cache
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
from typing import List, Optional
import subprocess
import tempfile
import sqlite3
import logging
import charset_normalizer
import platform

from autoreq.util import prune_code

from autoreq.constants import TEST_COVERAGE_SCRIPT_PATH

from typing import Union
from ..codebase import Codebase


@dataclass
class ValueMapping:
    identifier: str
    value: str

    def to_dict(self):
        return {'identifier': self.identifier, 'value': self.value}


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
        path_lines = [
            line.split(')', 1)[1].strip()
            for line in self.test_description.split('\n')
            if path_pattern.match(line)
        ]
        return '\n'.join(path_lines)

    def to_dict(self):
        return {
            'test_name': self.test_name,
            'test_description': self.test_description,
            'unit_name': self.unit_name,
            'subprogram_name': self.subprogram_name,
            'input_values': [v.to_dict() for v in self.input_values],
            'expected_values': [v.to_dict() for v in self.expected_values],
            'requirement_id': self.requirement_id,
        }

    def to_identifier(self):
        return f'{self.unit_name}.{self.subprogram_name}.{self.test_name}'


def _get_vectorcast_cmd(executable: str, args: List[str] = None) -> List[str]:
    """Generate a properly formatted VectorCAST command based on the OS."""
    vectorcast_dir = os.environ.get('VECTORCAST_DIR', '')
    is_windows = platform.system() == 'Windows'
    sep = '\\' if is_windows else '/'
    exe_ext = '.exe' if is_windows else ''

    exe_path = f'{vectorcast_dir}{sep}{executable}{exe_ext}'
    return [exe_path] + (args or [])


class Environment:
    def __init__(self, env_file_path: str, use_sandbox: bool = True):
        env_file_path = os.path.abspath(env_file_path)
        self.env_file_path = env_file_path
        self.env_name = os.path.basename(env_file_path).replace('.env', '')
        env_dir = os.path.dirname(env_file_path)

        # Create a separate temporary directory for temporary files
        self.temp_files_dir = tempfile.mkdtemp(prefix=f'vcast_{self.env_name}_')

        if use_sandbox:
            import shutil

            self.temp_dir = tempfile.TemporaryDirectory()
            self.env_dir = self.temp_dir.name
            shutil.copytree(env_dir, self.env_dir, dirs_exist_ok=True)
        else:
            self.env_dir = env_dir
        self._tu_codebase_paths = None
        self._used_atg_identifier_fallback = False
        self._used_atg_testable_functions_fallback = False

    def _get_temporary_file_path(self, filename: str) -> str:
        """Generate a path for a temporary file in the temporary files directory."""
        return os.path.join(self.temp_files_dir, filename)

    @property
    def is_built(self) -> bool:
        db_path = os.path.join(self.env_dir, self.env_name, 'master.db')
        return os.path.exists(db_path)

    def build(self):
        env_name = self.env_name
        cmd = _get_vectorcast_cmd('enviroedg', [f'{env_name}.env'])

        env_vars = os.environ.copy()
        env_vars['VCAST_FORCE_OVERWRITE_ENV_DIR'] = '1'

        try:
            result = subprocess.run(
                cmd,
                cwd=self.env_dir,
                env=env_vars,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            logging.error(f"Command '{' '.join(cmd)}' timed out after 30 seconds")
            return None

        logging.debug('Command: %s Return code: %s', ' '.join(cmd), result.returncode)

        if result.returncode != 0:
            error_msg = f"Build command '{' '.join(cmd)}' failed with error:\n{result.stderr or result.stdout}"
            raise RuntimeError(error_msg)

    def run_tests(self, test_cases: List[str], **kwargs) -> Optional[str]:
        tst_file_path = self._get_temporary_file_path(f'temp_tests_{self.env_name}.tst')
        with open(tst_file_path, 'w', encoding='utf-8') as temp_tst_file:
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
            # No need to delete here, will be cleaned up by cleanup() method

            return output

    def _get_coverage_info(self, tests: TestCase) -> Optional[dict]:
        cmd = _get_vectorcast_cmd(
            'vpython',
            [
                str(TEST_COVERAGE_SCRIPT_PATH),
                self.env_name,
                *(t.to_identifier() for t in tests),
            ],
        )

        try:
            result = subprocess.run(
                cmd,
                cwd=self.env_dir,
                env=os.environ.copy(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            logging.error(f"Command '{' '.join(cmd)}' timed out after 30 seconds")
            return None

        if result.returncode != 0:
            error_msg = f"Coverage command '{' '.join(cmd)}' failed with error:\n{result.stderr or result.stdout}"
            raise RuntimeError(error_msg)

        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as e:
            logging.error(f'Failed to parse coverage data: {e}')
            return None

    def run_test_script(self, tst_file_path: str, with_coverage=False) -> Optional[str]:
        tst_file_path = os.path.abspath(tst_file_path)

        with open(tst_file_path, 'r') as f:
            content = f.read()

        if 'MIXED_CASE_NAMES' not in content:
            logging.warning(
                'The MIXED_CASE_NAMES script feature is not enabled in your script, watch out when trying to run tests with mixed case names'
            )

        tests = self._parse_test_script(tst_file_path)

        commands = [
            _get_vectorcast_cmd(
                'clicast',
                ['-lc', '-e', self.env_name, 'Test', 'Script', 'Run', tst_file_path],
            ),
            *[
                _get_vectorcast_cmd(
                    'clicast',
                    [
                        '-lc',
                        '-e',
                        self.env_name,
                        '-u',
                        test.unit_name,
                        '-s',
                        test.subprogram_name,
                        '-t',
                        test.test_name,
                        'Execute',
                        'Run',
                    ],
                )
                for test in tests
            ],
        ]

        removal_commands = [
            _get_vectorcast_cmd(
                'clicast',
                [
                    '-lc',
                    '-e',
                    self.env_name,
                    '-u',
                    test.unit_name,
                    '-s',
                    test.subprogram_name,
                    '-t',
                    test.test_name,
                    'Test',
                    'Delete',
                ],
            )
            for test in tests
        ]

        output = ''
        env_vars = os.environ.copy()
        # Execute the commands using subprocess and capture the outputs
        for cmd in commands:
            try:
                result = subprocess.run(
                    cmd,
                    cwd=self.env_dir,
                    env=env_vars,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=30,
                )
            except subprocess.TimeoutExpired:
                logging.error(f"Command '{' '.join(cmd)}' timed out after 30 seconds")
                return None

            logging.debug("Command '%s' output:\n%s", cmd, result.stdout)
            logging.debug('Command: %s Return code: %s', cmd, result.returncode)

            output += result.stdout

        if with_coverage:
            coverage_data = self._get_coverage_info(tests)
            output = (output, coverage_data)

        # Remove the test cases
        for cmd in removal_commands:
            try:
                result = subprocess.run(
                    cmd,
                    cwd=self.env_dir,
                    env=env_vars,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=30,
                )
            except subprocess.TimeoutExpired:
                logging.error(f"Command '{' '.join(cmd)}' timed out after 30 seconds")
                return None

            logging.debug("Command '%s' output:\n%s", cmd, result.stdout)
            logging.debug('Command: %s Return code: %s', cmd, result.returncode)

        return output

    @cached_property
    def allowed_identifiers(self) -> List[str]:
        env_name = self.env_name

        # Create a temporary file
        tst_file_path = self._get_temporary_file_path(
            f'identifiers_template_{env_name}.tst'
        )

        # Run the command to generate the test script template
        env_vars = os.environ.copy()

        cmd = _get_vectorcast_cmd(
            'clicast', ['-e', env_name, 'test', 'script', 'template', tst_file_path]
        )

        failed = False
        try:
            result = subprocess.run(
                cmd,
                cwd=self.env_dir,
                env=env_vars,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            logging.error(f"Command '{' '.join(cmd)}' timed out after 30 seconds")
            failed = True

        if not failed:
            if result.returncode != 0:
                error_msg = f"Command '{' '.join(cmd)}' failed with error:\n{result.stderr or result.stdout}"
                raise RuntimeError(error_msg)

            # Read the generated test script template
            with open(tst_file_path, 'r') as f:
                content = f.read()
            # No need to delete here, will be cleaned up by cleanup() method

            # Extract identifiers from SCRIPT.VALUE and SCRIPT.EXPECTED lines
            identifiers = []
            lines = content.splitlines()
            for line in lines:
                if line.startswith('TEST.VALUE') or line.startswith('TEST.EXPECTED'):
                    identifier = line.split(':', 1)[1].rsplit(':', 1)[0]
                    if identifier not in identifiers:
                        identifiers.append(identifier)

            if len(identifiers) > 0:
                return identifiers

        logging.warning('Failed to generate test script template')
        logging.warning('Falling back to scraping from ATG')
        self._used_atg_identifier_fallback = True

        used_identifiers = []
        for test in self.atg_tests:
            for value in test.input_values + test.expected_values:
                if value.identifier not in used_identifiers:
                    used_identifiers.append(value.identifier)

        return used_identifiers

    def get_allowed_identifiers_for_function(
        self,
        function_name,
        return_used_atg_fallback=False,
        focus_lines=None,
        max_array_index=None,
        remove_surely_stubbed_returns=False,
        remove_surely_stubbed_inputs=False,
    ):
        all_identifiers = self.allowed_identifiers
        definition = self.tu_codebase.find_definitions_by_name(function_name)[0]

        if focus_lines:
            definition = prune_code(definition, focus_lines)

        relevant_identifiers = []
        for identifier in all_identifiers:
            try:
                try:
                    unit, subprogram, entity = identifier.split('.')[:3]
                except:
                    logging.warning(f'Invalid identifier format: {identifier}')
                    relevant_identifiers.append(identifier)
                    continue

                subprogram = subprogram.split('::')[-1]  # Remove namespace if present

                entity_match = re.match(r'.*?\[(\d+)\]', entity)

                if entity_match:
                    array_index = int(entity_match.group(1))
                    if max_array_index is not None and array_index > max_array_index:
                        continue
                    entity = entity[
                        : entity.index('[')
                    ]  # Remove array index if present
                else:
                    entity = entity.split('[', 1)[
                        0
                    ]  # Remove array index if present (should not be)

                if '.str.' in identifier:
                    # Skip string identifiers
                    # TODO: Investigate why they exist
                    continue

                if unit == 'USER_GLOBALS_VCAST':
                    relevant_identifiers.append(identifier)
                    continue

                if entity == '(cl)':
                    relevant_identifiers.append(identifier)
                    continue

                if unit == 'uut_prototype_stubs':
                    is_return_value = '.return' in identifier

                    if remove_surely_stubbed_returns and is_return_value:
                        continue

                    if remove_surely_stubbed_inputs and not is_return_value:
                        continue

                if subprogram == '<<GLOBAL>>':
                    search_term = entity
                else:
                    search_term = subprogram

                if search_term in definition:
                    relevant_identifiers.append(identifier)
            except IndexError:
                logging.warning(f'Invalid identifier format: {identifier}')
                continue

        logging.debug(
            f'Found {len(relevant_identifiers)} relevant identifiers for function {function_name}'
        )

        if not relevant_identifiers and focus_lines:
            logging.warning(
                f'No relevant identifiers found for pruned function {function_name}. Using identifiers for unpruned function.'
            )
            relevant_identifiers = self.get_allowed_identifiers_for_function(
                function_name,
                return_used_atg_fallback=return_used_atg_fallback,
                focus_lines=None,
            )

        if return_used_atg_fallback:
            return relevant_identifiers, self._used_atg_identifier_fallback

        return relevant_identifiers

    @cached_property
    def source_files(self) -> List[str]:
        db_path = os.path.join(self.env_dir, self.env_name, 'master.db')

        if not os.path.exists(db_path):
            raise FileNotFoundError(
                f"Database file '{db_path}' not found. Ensure the environment is built."
            )

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
    def atg_tests(self) -> List[str]:
        env_name = self.env_name
        # First try with baselining
        atg_file = self._get_temporary_file_path('atg_for_regular_use.tst')
        cmd = _get_vectorcast_cmd('atg', ['-e', env_name, '--baselining', atg_file])
        env_vars = os.environ.copy()

        try:
            result = subprocess.run(
                cmd,
                cwd=self.env_dir,
                env=env_vars,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            logging.warning('ATG with baselining timed out, trying without baselining')
            # Retry without baselining
            cmd = _get_vectorcast_cmd('atg', ['-e', env_name, atg_file])
            try:
                result = subprocess.run(
                    cmd,
                    cwd=self.env_dir,
                    env=env_vars,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=30,
                )
            except subprocess.TimeoutExpired:
                logging.error('ATG command without baselining also timed out')
                return []

        if result.returncode != 0:
            logging.error(f'ATG command failed with error:\n{result.stderr}')
            return []

        if not os.path.exists(atg_file):
            logging.error('ATG file not generated')
            return []

        return self._parse_test_script(atg_file)

    @cached_property
    def atg_coverage(self):
        # Generate atg file if not already generated
        atg_file = self._get_temporary_file_path('atg_for_coverage.tst')

        cmd = _get_vectorcast_cmd('atg', ['-e', self.env_name, atg_file])
        try:
            result = subprocess.run(
                cmd,
                cwd=self.env_dir,
                env=os.environ.copy(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            logging.error('ATG coverage command timed out after 30 seconds')
            return None

        if result.returncode != 0:
            logging.error(f'ATG coverage command failed with error:\n{result.stderr}')
            return None

        # Get the coverage
        output, coverage = self.run_test_script(atg_file, with_coverage=True)

        return coverage

    @cached_property
    def basis_path_tests(self) -> List[str]:
        env_name = self.env_name
        basis_test_file = self._get_temporary_file_path('basis.tst')
        cmd = _get_vectorcast_cmd(
            'clicast', ['-e', env_name, 'tool', 'auto_test', basis_test_file]
        )
        env_vars = os.environ.copy()

        try:
            result = subprocess.run(
                cmd,
                cwd=self.env_dir,
                env=env_vars,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            logging.error(f"Command '{' '.join(cmd)}' timed out after 60 seconds")
            return []

        if result.returncode != 0:
            logging.error(f'Basis path command failed with error:\n{result.stderr}')
            return []

        if not os.path.exists(basis_test_file):
            logging.error('Basis path file not generated')
            return []

        return self._parse_test_script(basis_test_file)

    @cached_property
    def tu_codebase(self):
        if self._tu_codebase_paths is None:
            self._tu_codebase_paths = []

        for unit_name in self.units:
            content, encoding = self.get_tu_content(
                unit_name=unit_name, reduction_level='medium', return_encoding=True
            )

            # Sanitize unit_name for filename to avoid issues with special characters.
            safe_unit_name = re.sub(r'[^\w\-_\.]', '_', unit_name)
            temp_file_path = self._get_temporary_file_path(
                f'tu_code_{safe_unit_name}_{self.env_name}.cpp'
            )

            with open(temp_file_path, 'w', encoding=encoding) as temp_file:
                temp_file.write(content)
                temp_file.flush()

            self._tu_codebase_paths.append(temp_file_path)

        return Codebase(self._tu_codebase_paths)

    @cached_property
    def tu_codebase_paths(self):
        if self._tu_codebase_paths is None:
            self.tu_codebase
        return self._tu_codebase_paths

    @cached_property
    def source_codebase(self):
        return Codebase(self.source_files)

    @cached_property
    def testable_functions(self):
        all_functions_from_tus = self.tu_codebase.get_all_functions()

        assert len(self._tu_codebase_paths) == len(self.units), (
            'Mismatch in number of TUs and units.'
        )

        temp_path_to_info_map = {}
        for i, temp_abs_path in enumerate(self._tu_codebase_paths):
            unit_name = self.units[i]
            original_source_file = self.source_files[i]
            temp_path_to_info_map[temp_abs_path] = {
                'unit_name': unit_name,
                'original_source_file': original_source_file,
            }

        testable_functions = []
        for function in all_functions_from_tus:
            abs_temp_tu_file_path = function['file']
            info = temp_path_to_info_map.get(abs_temp_tu_file_path)

            if info:
                unit_name = info['unit_name']
                original_source_file = info['original_source_file']

                reduced_content = self.get_tu_content(
                    unit_name=unit_name, reduction_level='high'
                )
                if function['definition'] in reduced_content:
                    func_copy = function.copy()
                    func_copy['file'] = original_source_file
                    func_copy['unit_name'] = unit_name
                    testable_functions.append(func_copy)

        if testable_functions:
            return testable_functions

        logging.warning(
            'No testable functions found in the translation units using primary method.'
        )
        logging.warning('Falling back to scraping from ATG tests.')
        self._used_atg_testable_functions_fallback = True

        # Fallback logic:
        # Map unit names to their source files
        unit_to_source_file_map = {
            unit: src_file for unit, src_file in zip(self.units, self.source_files)
        }

        atg_derived_functions = []
        # Keep track of added subprograms per unit to avoid duplicates
        added_subprograms = set()

        for test_case in self.atg_tests:
            unit_name = test_case.unit_name
            subprogram_name = test_case.subprogram_name

            if (unit_name, subprogram_name) not in added_subprograms:
                original_source_file = unit_to_source_file_map.get(unit_name)
                if original_source_file:
                    # Structure matches what the primary method would produce if it only had name and file.
                    atg_derived_functions.append(
                        {
                            'name': subprogram_name,
                            'file': original_source_file,
                            'unit_name': unit_name,
                        }
                    )
                    added_subprograms.add((unit_name, subprogram_name))
                else:
                    logging.warning(
                        f"ATG test case for unit '{unit_name}' but unit not found in environment's source files."
                    )

        return atg_derived_functions

    @property
    def modules(self) -> str:
        return self.units

    @lru_cache(maxsize=128)
    def get_tu_content(
        self, unit_name=None, reduction_level='medium', return_encoding=False
    ):
        """Get the content of the translation unit file.for the specified unit name.

        Args:
            unit_name (str, optional): The name of the unit, if not specified and there are multiple units, an error will be raised. If there is only one unit, it will be used.
            reduction_level (str, optional): The level of reduction to apply to the translation unit content.
                The levels are:
                - low: The entire translation unit content is returned.
                - medium: Build-in definitions and declarations are removed.
                - high: Only the processed code from the actual source file is returned.
            return_encoding (bool, optional): If True, the encoding of the content is returned.

        Raises:
            FileNotFoundError: If the translation unit file is not found.

        Returns:
            str: The content of the translation unit file.
        """
        if unit_name is None and len(self.units) > 1:
            raise ValueError('Multiple units found. Please specify a unit name.')

        if unit_name is None:
            unit_name = self.units[0]
            unit_path = self.source_files[0]
        else:
            unit_index = self.units.index(unit_name)

            if unit_index == -1:
                raise ValueError(f'Unit name {unit_name} not found in the environment.')

            unit_path = self.source_files[unit_index]

        tu_path_c = os.path.join(self.env_dir, self.env_name, f'{unit_name}.tu.c')
        tu_path_cpp = os.path.join(self.env_dir, self.env_name, f'{unit_name}.tu.cpp')

        if os.path.exists(tu_path_c):
            tu_path = tu_path_c
        elif os.path.exists(tu_path_cpp):
            tu_path = tu_path_cpp
        else:
            raise FileNotFoundError(f'Translation unit file not found for {unit_name}')

        encoding = charset_normalizer.from_path(tu_path).best().encoding
        content = str(charset_normalizer.from_path(tu_path).best())

        if reduction_level == 'low':
            if return_encoding:
                return content, encoding
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

                # This is a bit less robust if there are files with the same name in different directories
                # (compared to checking the entire path)
                # However it gets around issues of moving environments around without forcing the user to rebuild
                if Path(file_path_in_marker).stem == Path(unit_path).stem:
                    in_relevant_context = True
                elif (
                    match.group(1).startswith('vcast_preprocess')
                    or reduction_level == 'high'
                ):
                    in_relevant_context = False
            elif in_relevant_context:
                relevant_lines.append(line)

        relevant_content = '\n'.join(relevant_lines)

        if return_encoding:
            return relevant_content, encoding

        return relevant_content

    def _parse_test_script(self, tst_file_path: Union[str, os.PathLike]) -> List[str]:
        # with open(tst_file_path, 'r') as f:
        #    content = f.readlines()
        content = str(charset_normalizer.from_path(tst_file_path).best()).splitlines()

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
                    test_description='',
                    unit_name=current_unit,
                    subprogram_name=current_subprogram,
                    input_values=[],
                    expected_values=[],
                )

            elif line.startswith('TEST.VALUE:'):
                if not current_test:
                    continue

                _, rest = line.split(':', 1)
                identifier, value = rest.rsplit(':', 1)
                current_test.input_values.append(
                    ValueMapping(identifier=identifier.strip(), value=value.strip())
                )

            elif line.startswith('TEST.NOTES:'):
                if current_test:
                    description_lines = []
                    continue_reading = True

            elif line.startswith('TEST.END_NOTES:'):
                if current_test and description_lines:
                    current_test.test_description = '\n'.join(description_lines)
                continue_reading = False

            elif line.startswith('TEST.EXPECTED:'):
                if not current_test:
                    continue

                _, rest = line.split(':', 1)
                identifier, value = rest.rsplit(':', 1)
                current_test.expected_values.append(
                    ValueMapping(identifier=identifier.strip(), value=value.strip())
                )

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

    def _run_command(self, command: str, timeout=30) -> str:
        try:
            subprocess.run(
                command,
                cwd=self.env_dir,
                env=os.environ.copy(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout,
            )
            return True
        except subprocess.TimeoutExpired:
            logging.error(f"Command '{' '.join(command)}' timed out after 30 seconds")
            return False

    def cleanup(self):
        """Clean up all temporary files and directories."""
        # Clean up translation unit files
        if self._tu_codebase_paths:
            for path in self._tu_codebase_paths:
                if os.path.exists(path):
                    os.remove(path)

        # Clean up the temporary files directory
        if os.path.exists(self.temp_files_dir):
            import shutil

            shutil.rmtree(self.temp_files_dir)

        # Clean up the environment sandbox if it exists
        if hasattr(self, 'temp_dir'):
            self.temp_dir.cleanup()
