from __future__ import annotations
import typing as t
import re
import glob
import os
from typing import List
import platform
import subprocess
import shutil
import logging

from tree_sitter import Language, Parser
import tree_sitter_cpp as ts_cpp
from bs4 import BeautifulSoup

from collections import Counter
from pydantic import BaseModel, create_model
from datetime import datetime
import json
import base64
from typing import Callable, Dict, Optional
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from appdirs import user_cache_dir

from autoreq.constants import APP_NAME

if t.TYPE_CHECKING:
    from autoreq.llm_client import LLMClient
    from autoreq.test_generation.environment import Environment


def paths_to_files(paths, file_extensions=['c']):
    """
    Recursively identifies all file paths in the given directory and file paths.

    Parameters:
        paths (list of str): List of directory paths to search for files.
        file_extensions (list of str, optional): List of file extensions to consider when recursively finding files in directories. Defaults to ['c'].

    Returns:
        set: A set of file paths expanded from the given directory or direct file paths.
    """
    full_paths = [os.path.abspath(path) for path in paths]
    files = set()
    for path in full_paths:
        if os.path.isfile(path):
            files.add(path)
        else:
            files |= set(
                p
                for ext in file_extensions
                for p in glob.glob(
                    os.path.join(path, '**', '*') + '.' + ext, recursive=True
                )
            )

    return files


class TempCopy:
    def __init__(
        self, source_path: str, transform: t.Optional[t.Callable[[str], str]] = None
    ):
        """
        Context manager that creates a temporary copy of a file with optional content transformation.

        Args:
            source_path (str): Path to the source file to copy
            transform (Callable[[str], str], optional): Function to transform the file contents
        """
        self.source_path = source_path
        self.transform = transform
        self.temp_path = None

    def __enter__(self) -> str:
        # Create temporary file in same directory with unique name
        source_dir = os.path.dirname(self.source_path)
        source_name = os.path.basename(self.source_path)
        base, ext = os.path.splitext(source_name)

        # Find a unique filename by appending numbers
        counter = 1
        while True:
            temp_name = f'{base}_temp_{counter}{ext}'
            self.temp_path = os.path.join(source_dir, temp_name)
            if not os.path.exists(self.temp_path):
                break
            counter += 1

        # Copy content with optional transformation
        with open(self.source_path, 'r') as src:
            content = src.read()
            if self.transform:
                content = self.transform(content)
            with open(self.temp_path, 'w') as dst:
                dst.write(content)

        return self.temp_path

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.temp_path and os.path.exists(self.temp_path):
            os.unlink(self.temp_path)


def replace_func_and_var(code: str):
    FUNC_REGEX = re.compile(r'FUNC\((\w+?), ?\w+?\)')
    VAR_REGEX = re.compile(r'VAR\((\w+?), ?\w+?\)')

    def replace(match):
        return match.group(1)

    code = FUNC_REGEX.sub(replace, code)
    code = VAR_REGEX.sub(replace, code)

    return code


def ensure_env(required_keys, fallback, force_fallback=False):
    result = {}
    for key in required_keys:
        result[key] = ENV_STORE.load(
            key, (lambda k=key: fallback(k)) if fallback else None, force_fallback
        )

    for key, value in result.items():
        os.environ[key] = value

    return result


class EnvStore:
    def __init__(self):
        self._cache_dir = Path(user_cache_dir(APP_NAME))
        self._cache_file = self._cache_dir / 'env_cache.enc'
        self._cache: Dict[str, str] = {}
        self._fernet = self._setup_encryption()
        self._load_cache()

    def _setup_encryption(self) -> Fernet:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'secure_env_manager_salt',
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(APP_NAME.encode()))
        return Fernet(key)

    def _load_cache(self) -> None:
        if self._cache_file.exists():
            encrypted = self._cache_file.read_bytes()
            try:
                decrypted = self._fernet.decrypt(encrypted)
                self._cache = json.loads(decrypted)
            except Exception:
                self._cache = {}

    def _save_cache(self) -> None:
        self._cache_dir.mkdir(parents=True, exist_ok=True)
        encrypted = self._fernet.encrypt(json.dumps(self._cache).encode())
        self._cache_file.write_bytes(encrypted)

    def load(
        self,
        key: str,
        fallback: Optional[Callable[[], str]] = None,
        force_fallback: bool = False,
        allow_from_env: bool = True,
    ) -> str:
        if not force_fallback:
            # Check actual environment first
            value = os.environ.get(key)
            if value is not None and allow_from_env:
                return value

            # Check cache
            if key in self._cache:
                return self._cache[key]

        # Use fallback if provided
        if fallback is not None:
            value = fallback()
            self._cache[key] = value
            self._save_cache()
            return value

        raise KeyError(f"Environment variable '{key}' not found")

    def store(self, key: str, value: str) -> None:
        self._cache[key] = value
        self._save_cache()

    def clear(self) -> None:
        self._cache = {}
        if self._cache_file.exists():
            self._cache_file.unlink()


ENV_STORE = EnvStore()


def parse_code(code):
    parser = Parser()
    CPP_LANGUAGE = Language(ts_cpp.language(), 'cpp')
    parser.set_language(CPP_LANGUAGE)

    tree = parser.parse(bytes(code, 'utf-8'))
    root_node = tree.root_node

    return root_node


def setup_mlflow(mlflow_arg: t.Tuple[str, str]) -> t.Optional[t.Any]:
    """
    Set up MLflow tracking for the evaluation.

    Args:
        mlflow_arg: A tuple of (experiment_name, run_name)

    Returns:
        The MLflow module if successful, None otherwise
    """
    try:
        import mlflow
    except ImportError:
        print('Warning: mlflow is not installed. MLflow tracking is disabled.')
        return None

    # Set longer timeout for artifact uploads
    os.environ['MLFLOW_ARTIFACT_UPLOAD_DOWNLOAD_TIMEOUT'] = '1800'

    mlflow_server = os.environ.get('AUTOREQ_MLFLOW_SERVER')
    # Use server from config if available
    if mlflow_server:
        mlflow.set_tracking_uri(mlflow_server)

    experiment_name, run_name = mlflow_arg
    run_name += f' {datetime.now().strftime("%Y-%m-%d-%H:%M:%S")}'

    mlflow.set_experiment(experiment_name)
    mlflow.start_run(run_name=run_name)
    mlflow.set_tag('mlflow.runName', run_name)

    return mlflow


def setup_mlflow_params(
    mlflow, params: t.Dict[str, t.Any], expanded_env_req_pairs
) -> None:
    # Convert lists and other non-string types to strings for MLflow
    for k, v in params.items():
        if isinstance(v, list):
            params[k] = ','.join(map(str, v))
        elif not isinstance(v, (str, int, float, bool)):
            params[k] = str(v)
    mlflow.log_params(params)

    # Log information about the environments being processed
    mlflow.log_param(
        'environments',
        ','.join([Path(pair.split(':')[0]).stem for pair in expanded_env_req_pairs]),
    )
    mlflow.log_param('num_environments', len(expanded_env_req_pairs))


def expand_environment_args(env_args: t.List[str]) -> t.List[str]:
    """
    Expand environment arguments, replacing @filepath references with the contents
    of those files.
    """
    expanded_args = []
    for arg in env_args:
        if arg.startswith('@'):
            filepath = arg[1:]  # Remove the @ prefix
            try:
                file_envs = read_environments_from_file(filepath)
                expanded_args.extend(file_envs)
            except Exception as e:
                print(f'Error reading environments from file {filepath}: {e}')
        else:
            expanded_args.append(arg)
    return expanded_args


def read_environments_from_file(filepath: str) -> t.List[str]:
    """Read environment paths from a file, one per line."""
    if not os.path.exists(filepath):
        raise FileNotFoundError(f'Environment list file not found: {filepath}')

    with open(filepath, 'r') as f:
        # Read all lines and strip whitespace, skipping empty lines and comments
        return [
            line.strip()
            for line in f.readlines()
            if line.strip() and not line.strip().startswith('#')
        ]


def write_env_result(result, output_dir: Path) -> None:
    """Write individual environment results to a JSON file."""
    env_name = Path(result.environment_path).stem
    result_path = output_dir / f'{env_name}_result.json'
    with open(result_path, 'w') as f:
        json.dump(result.model_dump(by_alias=True), f, indent=2)


def get_processed_environments(output_dir: Path) -> set:
    """Get set of environment names that have already been processed."""
    return {p.stem.replace('_result', '') for p in output_dir.glob('*_result.json')}


def format_time(seconds):
    """Format seconds into human-readable time format"""
    one_minute = 60
    one_hour = 3600
    if seconds < one_minute:
        return f'{seconds:.2f} seconds'
    elif seconds < one_hour:
        minutes = seconds / one_minute
        return f'{minutes:.2f} minutes'
    else:
        hours = seconds / one_hour
        return f'{hours:.2f} hours'


def average_set(sets, threshold_frequency=0.5):
    n = len(sets)
    cnt = Counter(x for s in sets for x in s)
    return {x for x, c in cnt.items() if c / n >= threshold_frequency}


def prune_code(code: str, line_numbers_to_keep: List[int]) -> str:
    """
    Prunes code by keeping only nodes that contain lines specified in line_numbers_to_keep.

    Args:
        code: Source code to prune
        line_numbers_to_keep: List of 0-based line numbers to preserve

    Returns:
        Pruned source code as string
    """
    PROTECTED_CHILDREN = {
        'if_statement': ['condition'],
        'for_statement': ['initializer', 'condition', 'update'],
        'while_statement': ['condition'],
        'switch_statement': ['condition'],
        'case_statement': ['value', 'break_statement'],
        'do_statement': ['condition'],
        'function_definition': ['type', 'declarator', 'parameters'],
        'else_clause': ['condition'],
        'expression_statement': '*',
        'return_statement': '*',
        'throw_statement': '*',
        'break_statement': '*',
        'continue_statement': '*',
        'comment': '*',
    }

    PROTECTED_LEAFS = [
        ':',
        ',',
        ';',
        '{',
        '}',
        '(',
        ')',
        'if',
        'else',
        'for',
        'while',
        'do',
        'switch',
        'case',
        'default',
    ]

    def node_contains_line(node, line_number):
        return node.start_point[0] <= line_number <= node.end_point[0]

    def node_contains_any_line(node):
        return any(node_contains_line(node, ln) for ln in line_numbers_to_keep)

    def is_protected(node, parent):
        protected_roles = PROTECTED_CHILDREN.get(parent.type, [])

        if protected_roles == '*':
            return True

        return any(
            parent.child_by_field_name(role) == node or node.type == role
            for role in protected_roles
        )

    def removable_ranges(node):
        if node.type == 'for_statement':
            # print(node.sexp())
            pass

        # Just pass through compount statements in case we would remove something here
        if node.type == 'compound_statement':
            return [r for child in node.children for r in removable_ranges(child)]

        if not node_contains_any_line(node) and node.type not in PROTECTED_LEAFS:
            # print("Removed:", node.text, node.start_point, node.end_point, node.type)
            return [(node.start_point, node.end_point)]

        # Process children
        ranges = []
        for child in node.children:
            if is_protected(child, node):
                # print("Protected:", child.text)
                continue

            ranges.extend(removable_ranges(child))

        return ranges

    def merge_ranges(ranges):
        merged = []
        for start, end in sorted(ranges):
            if not merged:
                merged.append((start, end))
                continue

            previous_start, previous_end = merged[-1]

            if start > previous_end:
                merged.append((start, end))
                continue

            merged[-1] = (previous_start, max(previous_end, end))

        return merged

    def to_str_position(string, line, column):
        lines = string.splitlines()
        line_start_index = sum(len(_l) + 1 for _l in lines[:line])

        return line_start_index + column

    def prune_code(code, ranges):
        for range in reversed(sorted(ranges)):
            start, end = range
            start_pos = to_str_position(code, start[0], start[1])
            end_pos = to_str_position(code, end[0], end[1])
            code = code[:start_pos] + code[end_pos:]

        code = re.sub(r'(\n\s*)+\n', '\n', code)

        return code

    parser = Parser()
    CPP_LANGUAGE = Language(ts_cpp.language(), 'cpp')
    parser.set_language(CPP_LANGUAGE)

    code_bytes = code.encode('utf-8')
    tree = parser.parse(code_bytes)

    ranges = merge_ranges(removable_ranges(tree.root_node))
    return prune_code(code, ranges)


def get_executable_statement_groups(code: str, include_virtual_groups: bool = False):
    """
    Extract executable statement groups from code using tree-sitter.
    Returns a list of lists, where each inner list contains line numbers of statements
    that belong to the same execution path.

    Args:
        code: Source code to analyze
        include_virtual_groups: If True, creates virtual groups for empty constructs and non-entry paths
    """
    root_node = parse_code(code)

    # print(root_node.sexp())

    COLLECTED_NODE_TYPES = [
        'expression_statement',
        'return_statement',
        'throw_statement',
        #'break_statement',
        #'continue_statement',
    ]

    IGNORED_NODE_TYPES = [
        'comment',
    ]

    PATH_NODE_CHILD_PATH_LABELS = {
        'if_statement': {
            'consequence': 'IF {} ==> TRUE',
            'alternative': 'IF {} ==> FALSE',
        },
        'while_statement': {'body': 'WHILE {} ==> TRUE'},
        'for_statement': {'body': 'FOR ({}) ==> TRUE'},
        'do_statement': {'body': 'DO-WHILE {} ==> TRUE'},
        'switch_statement': {'body': 'SWITCH {} ==> ENTERED'},
        'case_statement': {'*': 'CASE {} ==> ENTERED'},
        #'try_statement': {
        #    'body': 'ENTERED'
        # },
        #'catch_clause': {
        #    'body': 'ENTERED'
        # },
        # TODO: Deal with condition stuff for try and catch
    }

    PATH_NODE_CHILD_PATH_CONDITION = {
        'if_statement': 'condition',
        'while_statement': 'condition',
        'for_statement': 'condition',
        'do_statement': 'condition',
        'switch_statement': 'condition',
        'case_statement': 'value',
    }

    # Define non-entry path labels for each construct type
    PATH_NODE_NON_ENTRY_LABELS = {
        'if_statement': 'IF {condition} ==> FALSE',
        'while_statement': 'WHILE {condition} ==> FALSE',
        'for_statement': 'FOR ({condition}) ==> FALSE',
        'do_statement': 'DO-WHILE {condition} ==> FALSE',
        'switch_statement': 'SWITCH {condition} ==> NO_MATCH',
    }

    class CollectedNode(BaseModel):
        line_numbers: List[int]
        path: List[str]
        symbols: List[str]

    class StatementGroup(BaseModel):
        line_numbers: List[int]
        path: List[str]
        symbols: List[str]

        @property
        def lines(self):
            lines = code.splitlines()
            return [lines[i] for i in self.line_numbers]

        def __str__(self):
            # First, construct the path
            path_str = '\n -> '.join(self.path)

            code_lines = code.splitlines()

            start_line = min(self.line_numbers)
            end_line = max(self.line_numbers)

            lines_str = '\n'.join(
                code_lines[i] for i in range(start_line, end_line + 1)
            )

            return f'Path: {path_str}\nLines:\n{lines_str}'

        @staticmethod
        def from_collected_nodes(collected_nodes):
            assert len(set(tuple(node.path) for node in collected_nodes)) == 1, (
                'All collected nodes must have the same path'
            )
            return StatementGroup(
                line_numbers=[
                    line for node in collected_nodes for line in node.line_numbers
                ],
                path=collected_nodes[0].path,
                symbols=list(
                    set(symbol for node in collected_nodes for symbol in node.symbols)
                ),
            )

    def extract_symbols_from_node(node):
        """Extract symbols from any tree-sitter node"""
        symbols = set()

        def visit_node(node):
            if node.type in ('identifier', 'type_identifier', 'field_identifier'):
                symbols.add(node.text.decode('utf-8'))
            for child in node.children:
                visit_node(child)

        if node:
            visit_node(node)
        return list(symbols)

    # Function to collect statements by execution path
    def collect_statements(node, curr_path):
        curr_path = curr_path.copy()
        if node.type in IGNORED_NODE_TYPES:
            return None

        # Check if this is a statement that should be collected
        if node.type in COLLECTED_NODE_TYPES:
            # Add the line number to the current group
            line_number_start = node.start_point[0]
            line_number_end = node.end_point[0]
            symbols = extract_symbols_from_node(node)
            return CollectedNode(
                line_numbers=list(range(line_number_start, line_number_end + 1)),
                path=curr_path,
                symbols=symbols,
            )

        if node.type in PATH_NODE_CHILD_PATH_LABELS:
            condition = node.child_by_field_name(
                PATH_NODE_CHILD_PATH_CONDITION[node.type]
            )
            if not condition and node.type == 'case_statement':
                path_labels = {
                    field: re.sub(r'\s{2,}', ' ', 'DEFAULT ==> ENTERED')
                    for field in PATH_NODE_CHILD_PATH_LABELS[node.type]
                }
                condition_text = 'default'
            else:
                condition_text = condition.text.decode('utf-8') if condition else 'None'
                path_labels = {
                    field: re.sub(
                        r'\s{2,}',
                        ' ',
                        PATH_NODE_CHILD_PATH_LABELS[node.type][field].format(
                            condition_text.replace('\n', '')
                        ),
                    )
                    for field in PATH_NODE_CHILD_PATH_LABELS[node.type]
                }
        else:
            path_labels = {}
            condition = None
            condition_text = None

        groups = []
        virtual_groups = []

        any_prior_child_had_groups = False

        def has_group_somewhere(groups):
            if isinstance(groups, list):
                return any(has_group_somewhere(g) for g in groups)

            return groups is not None

        # Recursively process other nodes
        for i, child in enumerate(node.children):
            # Check if this child is a condition part
            field_name = next(
                (
                    field
                    for field in PATH_NODE_CHILD_PATH_LABELS.get(node.type, {})
                    if node.child_by_field_name(field) == child
                ),
                None,
            )
            path_label = path_labels.get(field_name) or path_labels.get('*')

            if path_label:
                new_path = [*curr_path, path_label]
            else:
                new_path = curr_path

            child_result = collect_statements(child, new_path)
            groups.append(child_result)

            # Check if we need to create virtual groups for empty constructs

            # For everything except case statements, we can create virtual groups for each individual child independently
            # For case statements, we only create a virtual group if it's the last child (as the children are flat inside the ast)
            other_children_disallow_virtual_group = (
                node.type == 'case_statement' and any_prior_child_had_groups
            ) or i != len(node.children) - 1

            if (
                include_virtual_groups
                and path_label
                and not has_group_somewhere(child_result)
                and not other_children_disallow_virtual_group
            ):
                # Create empty body group - represents entering the construct but finding no statements
                condition_symbols = (
                    extract_symbols_from_node(condition) if condition else []
                )
                empty_body_group = CollectedNode(
                    line_numbers=[node.start_point[0]],
                    path=new_path,
                    symbols=condition_symbols,
                )
                virtual_groups.append(empty_body_group)

            any_prior_child_had_groups = (
                any_prior_child_had_groups or has_group_somewhere(child_result)
            )

        # Create non-entry virtual groups if enabled
        if include_virtual_groups and node.type in PATH_NODE_CHILD_PATH_LABELS:
            condition_symbols = (
                extract_symbols_from_node(condition) if condition else []
            )

            # Special handling for if/switch - don't create non-entry if there's else/default
            create_non_entry = True
            if node.type == 'if_statement':
                # Check if there's an else clause
                alternative = node.child_by_field_name('alternative')
                if alternative:
                    create_non_entry = False
            elif node.type == 'switch_statement':
                # Check if there's a default case in the switch body
                switch_body = node.child_by_field_name('body')
                if switch_body:
                    for child in switch_body.children:
                        if child.type == 'case_statement':
                            case_value = child.child_by_field_name('value')
                            if not case_value:  # This indicates a default case
                                create_non_entry = False
                                break
            elif node.type == 'case_statement':
                # For case statements, we don't create non-entry paths
                create_non_entry = False

            if create_non_entry:
                # Create non-entry path using the template
                condition_clean = (condition_text or '').replace('\n', '')
                template = PATH_NODE_NON_ENTRY_LABELS.get(node.type)

                assert template, (
                    f'No non-entry path label template defined for {node.type}'
                )

                non_entry_path_label = template.format(condition=condition_clean)

                non_entry_group = CollectedNode(
                    line_numbers=[node.start_point[0]],
                    path=[*curr_path, non_entry_path_label],
                    symbols=condition_symbols,
                )
                virtual_groups.append(non_entry_group)

        # Combine regular groups with virtual groups
        all_groups = groups + virtual_groups
        return all_groups if all_groups else groups

    # Start processing from the root
    executable_groups = collect_statements(root_node, [])

    def to_flat_groups(nested_groups):
        groups = []
        last_was_list = False
        for item in nested_groups:
            if item is None:
                continue
            elif isinstance(item, list):
                groups.extend(to_flat_groups(item))
                last_was_list = True
            else:
                if len(groups) == 0 or last_was_list:
                    groups.append([])

                if len(groups[-1]) > 0 and groups[-1][-1].path != item.path:
                    groups.append([])

                groups[-1].append(item)
                last_was_list = False

        return groups

    flat_groups = to_flat_groups(executable_groups)
    executable_groups = [
        StatementGroup.from_collected_nodes(group) for group in flat_groups if group
    ]

    return executable_groups


async def get_relevant_statement_groups(
    function_body: str,
    requirements: List[str],
    llm_client: LLMClient,
    add_related=True,
):
    requirements = list(requirements)
    # Split requirements into chunks
    max_requirements_len = 100
    if len(requirements) > max_requirements_len:
        results_first100 = await get_relevant_statement_groups(
            function_body, requirements[:max_requirements_len], llm_client
        )
        results_rest = await get_relevant_statement_groups(
            function_body, requirements[max_requirements_len:], llm_client
        )
        return results_first100 + results_rest

    result_keys = {
        f'group_indices_for_requirement_{i + 1}': (List[int], ...)
        for i in range(len(requirements))
    }
    schema = create_model('GenerationResult', **result_keys)

    requirements_text = '\n'.join([f'{i + 1}. {r}' for i, r in enumerate(requirements)])

    all_groups = get_executable_statement_groups(
        function_body, include_virtual_groups=True
    )

    prettified_groups = []
    for i, part in enumerate(all_groups):
        index_prefix = f'{i + 1}. '
        prettified_groups.append(index_prefix + str(part))

    groups_text = '\n'.join(prettified_groups)

    messages = [
        {
            'role': 'system',
            'content': 'You are a world-class software engineer specializing in requirements engineering.',
        },
        {
            'role': 'user',
            'content': f"""
Given the following code and a list of semantic parts of the code, identify the relevant parts of the code that are necessary to test the following requiremens. Return a list of indices of the relevant parts of the code for each requirement.

Code:
```c
{function_body}
```

Semantic parts:
{groups_text}

Requirements:
{requirements_text}

Answer in the following format:
```
{{
    "group_indices_for_requirement1": [1, 3, ...] # 1-indexed list of relevant statement groups,
    "group_indices_for_requirement2": [2, 4, ...] # 1-indexed list of relevant statement groups,
    ...
}}
```

""",
        },
    ]

    result = await llm_client.call_model(messages, schema)
    # return [groups[i-1] for i in result.group_indices if 1 <= i <= len(groups)]

    relevant_groups_batch = []
    for i, group_indices in enumerate(result.dict().values()):
        relevant_groups = [
            all_groups[i - 1] for i in group_indices if 1 <= i <= len(all_groups)
        ]
        if add_related:
            for other_group in all_groups:
                if other_group in relevant_groups:
                    continue

                related = not any(
                    s in other_group.symbols and is_prefix(other_group.path, group.path)
                    for group in relevant_groups
                    for s in group.symbols
                )

                if related:
                    continue

                relevant_groups.append(other_group)

        # Now sort by line numbers
        relevant_groups = sorted(relevant_groups, key=lambda g: g.line_numbers[0])

        relevant_groups_batch.append(relevant_groups)

    return relevant_groups_batch


def is_prefix(prefix, lst):
    return len(prefix) <= len(lst) and all(
        prefix[i] == lst[i] for i in range(len(prefix))
    )


def get_vectorcast_cmd(executable: str, args: List[str] = None) -> List[str]:
    """Generate a properly formatted VectorCAST command based on the OS."""
    is_windows = platform.system() == 'Windows'
    exe_ext = '.exe' if is_windows else ''
    exe_name = f'{executable}{exe_ext}'

    # Priority 1: Check VSCODE_VECTORCAST_DIR
    vscode_vectorcast_dir = os.environ.get('VSCODE_VECTORCAST_DIR')
    if vscode_vectorcast_dir:
        exe_path = os.path.join(vscode_vectorcast_dir, exe_name)
        if os.path.exists(exe_path):
            logging.debug(
                f'Using VectorCAST {exe_name} from VSCODE_VECTORCAST_DIR: {exe_path}'
            )
            return [exe_path] + (args or [])

    # Priority 2: Check VECTORCAST_DIR
    vectorcast_dir = os.environ.get('VECTORCAST_DIR')
    if vectorcast_dir:
        exe_path = os.path.join(vectorcast_dir, exe_name)
        if os.path.exists(exe_path):
            logging.debug(
                f'Using VectorCAST {exe_name} from VECTORCAST_DIR: {exe_path}'
            )
            return [exe_path] + (args or [])

    # Priority 3: Check if executable is available on PATH
    path_exe = shutil.which(exe_name)
    if path_exe:
        logging.debug(f'Using VectorCAST {exe_name} from PATH: {path_exe}')
        return [path_exe] + (args or [])

    # Fallback: Return VECTORCAST_DIR path even if it doesn't exist
    vectorcast_dir = os.environ.get('VECTORCAST_DIR', '')
    exe_path = os.path.join(vectorcast_dir, exe_name)
    logging.debug(f'Falling back to VECTORCAST_DIR (may not exist): {exe_path}')
    return [exe_path] + (args or [])


def sanitize_subprogram_name(subprogram_name: str) -> str:
    """
    Sanitize a subprogram name by removing any template or overloading parts.
    """

    last_name = ''
    while last_name != subprogram_name:
        last_name = subprogram_name

        sanitized_name = re.sub(r'<[^<>]*?>', '', subprogram_name)

        subprogram_name = sanitized_name

    # Now remove overloading parts
    subprogram_name = subprogram_name.split('(')[
        0
    ]  # Remove everything after the first '('

    return subprogram_name.strip()


def expand_env_paths(env_dirs) -> t.List[str]:
    def extract_from_file(file_path: str) -> t.List[Path]:
        with open(os.path.expandvars(file_path), 'r') as f:
            return [
                Path(os.path.expandvars(line.strip()))
                for line in f.readlines()
                if line.strip()
            ]

    if isinstance(env_dirs, list):
        if env_dirs[0].startswith('@'):
            envs = extract_from_file(env_dirs[0][1:])
        else:
            envs = [Path(os.path.expandvars(env_dir)) for env_dir in env_dirs]
    elif isinstance(env_dirs, str):
        if env_dirs.startswith('@'):
            envs = extract_from_file(env_dirs[1:])
        else:
            envs = [Path(os.path.expandvars(env_dirs))]
    elif isinstance(env_dirs, Path):
        envs = [Path(os.path.expandvars(str(env_dirs)))]
    else:
        raise ValueError('Invalid input for environment directories.')

    assert all(env.is_file() and env.suffix == '.env' for env in envs), (
        'One or more environment paths are not valid .env files.'
    )
    return [str(env) for env in envs]


def generate_clicast_html_coverage_report(env) -> t.Optional[Path]:
    """
    Generate an HTML coverage report using VectorCAST CLI commands.
    """
    cmds = [
        get_vectorcast_cmd(
            'clicast',
            [
                '-lc',
                'option',
                'VCAST_CUSTOM_REPORT_FORMAT',
                'HTML',
            ],
        ),
        get_vectorcast_cmd(
            'clicast',
            [
                '-lc',
                '-e',
                env.env_name,
                'REports',
                'Custom',
                'Coverage',
                'coverage.html',
            ],
        ),
    ]
    for cmd in cmds:
        subprocess.run(
            cmd,
            shell=False,
            check=False,
            cwd=env.env_dir,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    coverage_file = Path(env.env_dir, 'coverage.html')
    if not coverage_file.exists():
        logging.warning(f'Coverage report generation failed for {env.env_name}')
        return None
    return coverage_file


def _create_source_table(soup: BeautifulSoup):
    table = soup.new_tag('table', attrs={'class': 'table table-small sfp-table'})

    thead = soup.new_tag('thead')
    tr = soup.new_tag('tr')

    th_cursor = soup.new_tag(
        'th',
        attrs={
            'class': 'sfp_cursor',
            'onclick': "collapsibleFile(this, 'file2', 'ips_file2')",
        },
    )
    span_plus = soup.new_tag(
        'span',
        attrs={
            'class': 'sfp-span expansion_row_icon_plus',
            'id': 'expansion_file_icon_plus_file2',
        },
    )
    span_plus.string = '+'
    span_minus = soup.new_tag(
        'span',
        attrs={
            'class': 'sfp-span expansion_row_icon_minus',
            'id': 'expansion_file_icon_minus_file2',
        },
    )
    span_minus.string = '-'

    th_cursor.append(span_plus)
    th_cursor.append(span_minus)

    th_line = soup.new_tag('th', attrs={'class': 'sfp_number'})
    th_line.string = 'Line'

    th_color = soup.new_tag('th', attrs={'class': 'sfp_color'})

    th_st = soup.new_tag('th', attrs={'class': 'sfp_coverage'})
    th_st.string = 'St'

    th_br = soup.new_tag('th', attrs={'class': 'sfp_coverage'})
    th_br.string = 'Br'

    th_empty = soup.new_tag('th')

    for th_element in (th_cursor, th_line, th_color, th_st, th_br, th_empty):
        tr.append(th_element)

    thead.append(tr)
    table.append(thead)

    return table


def generate_custom_coverage_reports(
    env: Environment,
    original_coverage_report: Path,
    requirement_coverage_results,
    output_dir: Path,
    full_coverage_report: bool = False,
) -> None:
    """
    Generates custom coverage reports, modifying an existing coverage report generated with clicast and
    integrating requirement coverage results into the report. Processes the coverage data to highlight
    the specified lines of code based on coverage results and produces individual HTML files for each
    specified requirement where total coverage was not achieved.
    Source content comes from the TU content of the environment, which is the same content used to
    generate the requirements.
    """
    tu_content = env.get_tu_content(reduction_level='high')
    all_funcs = env.functions_info()

    with open(original_coverage_report, 'r') as f:
        cov_html = BeautifulSoup(f, 'html.parser')

    # Remove the Metrics section from the coverage report's bottom
    metrics_link = cov_html.find('a', href='#Metrics')
    if metrics_link:
        metrics_li = metrics_link.find_parent('li')
        if metrics_li:
            metrics_li.decompose()
    metrics_section = cov_html.find('a', id='Metrics')
    if metrics_section:
        report_block = metrics_section.find_parent('div', class_='report-block')
        if report_block:
            report_block.decompose()

    # Cleaning up the coverage report
    coverage_div = cov_html.find('div', class_='report-block-coverage')
    for children in coverage_div.find_all(recursive=False):
        if children.name == 'div' and children.get('class') == ['row']:
            continue
        children.decompose()

    source_table = _create_source_table(cov_html)
    coverage_div.append(source_table)

    uncovered_required_color = '#e93939'
    covered_required_color = '#6ee96e'
    covered_color = '#c8f0c8'
    td_style = 'width: 2em;min-width: 2em;background-color: {color}'

    for rcr in requirement_coverage_results:
        if not full_coverage_report and rcr['fully_covered']:
            continue

        tbody = cov_html.new_tag('tbody')
        source_table.append(tbody)

        all_table_rows = []  # List to hold all HTML lines for source code
        for i, line in enumerate(tu_content.split('\n')):
            tr = cov_html.new_tag('tr')
            cells = [
                ('sfp_coverage', ' '),
                ('sfp_number', str(i + 1)),
                ('sfp_color', None),
                ('sfp_coverage', ' '),
                ('sfp_coverage', '   '),
            ]
            for cls, text in cells:
                td = cov_html.new_tag('td', attrs={'class': cls})
                if text is not None:
                    td.string = text
                tr.append(td)

            td = cov_html.new_tag('td')
            code = cov_html.new_tag('code', attrs={'class': 'sfp-code'})
            span = cov_html.new_tag('span')
            span.string = line
            code.append(span)
            td.append(code)
            tr.append(td)

            tbody.append(tr)
            all_table_rows.append(tr)

        req_id = rcr['requirement_id']
        func_info = all_funcs[rcr['function']]
        start_line = func_info['start_line']
        for line in rcr['covered_lines']:
            all_table_rows[start_line + line].find_all('td')[2]['style'] = (
                td_style.format(color=covered_color)
            )
        for line in rcr['required_lines']:
            c = (
                covered_required_color
                if line in rcr['covered_lines']
                else uncovered_required_color
            )
            all_table_rows[start_line + line].find_all('td')[2]['style'] = (
                td_style.format(color=c)
            )

        with open(output_dir / f'{req_id}_coverage.html', 'w') as f:
            f.write(str(cov_html))

        tbody.decompose()


def are_paths_equal(path1: str, path2: str) -> bool:
    """
    Compare two paths for equality
    """
    p1 = Path(path1)
    p2 = Path(path2)

    if p1.exists() and p2.exists():
        return p1.samefile(p2)

    return p1.resolve(strict=False) == p2.resolve(strict=False)


class Trie:
    """
    A trie (prefix tree) data structure for storing sequences of items.

    This implementation allows storing any hashable items, not just characters,
    making it suitable for storing lists of strings, paths, etc.
    """

    class TrieNode:
        def __init__(self):
            self.children = {}
            self.is_end = False

        def __contains__(self, key):
            return key in self.children

        def __getitem__(self, key):
            return self.children[key]

        def __setitem__(self, key, value):
            self.children[key] = value

        def __iter__(self):
            return iter(self.children)

        def items(self):
            return self.children.items()

    def __init__(self):
        self.root = self.TrieNode()

    def insert(self, sequence):
        """
        Insert a sequence into the trie.

        Args:
            sequence: An iterable of hashable items to insert
        """
        node = self.root
        for item in sequence:
            if item not in node:
                node[item] = self.TrieNode()
            node = node[item]
        node.is_end = True

    def search(self, sequence):
        """
        Search for a complete sequence in the trie.

        Args:
            sequence: An iterable of hashable items to search for

        Returns:
            bool: True if the sequence exists as a complete path, False otherwise
        """
        node = self.root
        for item in sequence:
            if item not in node:
                return False
            node = node[item]
        return node.is_end

    def starts_with(self, prefix):
        """
        Check if any sequence in the trie starts with the given prefix.

        Args:
            prefix: An iterable of hashable items representing the prefix

        Returns:
            bool: True if any sequence starts with the prefix, False otherwise
        """
        return len(self.get_descendants(prefix)) > 0

    def get_descendants(self, prefix):
        """
        Get all sequences in the trie that start with the given prefix.

        Args:
            prefix: An iterable of hashable items representing the prefix

        Returns:
            List[tuple]: A list of tuples representing all sequences that start with the prefix
        """
        node = self.root
        for item in prefix:
            if item not in node:
                return []
            node = node[item]

        sequences = []

        def dfs(current_node, current_sequence):
            if current_node.is_end:
                sequences.append(tuple(current_sequence))

            for item, child_node in current_node.items():
                dfs(child_node, current_sequence + [item])

        dfs(node, list(prefix))
        return sequences

    def get_ancestors(self, sequence):
        """
        Get all sequences in the trie that are ancestors of the given sequence.

        Args:
            sequence: An iterable of hashable items representing the sequence
        Returns:
            List[tuple]: A list of tuples representing all ancestor sequences
        """
        ancestors = []
        node = self.root
        current_sequence = []
        for item in sequence:
            if item not in node:
                break

            node = node[item]
            current_sequence.append(item)

            if node.is_end:
                ancestors.append(tuple(current_sequence))

        return ancestors

    def get_all_sequences(self):
        """
        Get all complete sequences stored in the trie.

        Returns:
            List[tuple]: A list of tuples representing all stored sequences
        """
        sequences = []

        def dfs(node, current_sequence):
            if node.is_end:
                sequences.append(tuple(current_sequence))

            for item, child_node in node.items():
                dfs(child_node, current_sequence + [item])

        dfs(self.root, [])
        return sequences

    def get_unique_prefixes(self):
        """
        Get the shortest unique prefixes for all sequences in the trie.
        This is useful when you want to find the minimal distinguishing prefixes.

        Returns:
            List[tuple]: A list of tuples representing unique prefixes
        """
        unique_prefixes = []

        def dfs(node, current_prefix):
            if node.is_end:
                unique_prefixes.append(tuple(current_prefix))
                return

            for item, child_node in node.items():
                dfs(child_node, current_prefix + [item])

        dfs(self.root, [])
        return unique_prefixes


def get_unique_prefixes(prefix_lists):
    """
    Find unique prefixes from a list of prefix lists using a trie data structure.

    Args:
        prefix_lists: A list of sequences (lists) to find unique prefixes for

    Returns:
        List[tuple]: A list of tuples representing the unique prefixes
    """
    trie = Trie()

    # Insert all sequences into the trie
    for prefix_list in prefix_lists:
        trie.insert(prefix_list)

    # Get all unique prefixes
    return trie.get_unique_prefixes()


# Based on: https://stackoverflow.com/questions/1151658/python-hashable-dicts
class HashableCounter(Counter):
    def _key(self):
        return tuple((k, self[k]) for k in sorted(self))

    def __hash__(self):
        return hash(self._key())

    def __eq__(self, other):
        if not isinstance(other, HashableCounter):
            return False
        return self._key() == other._key()


def extract_code_symbols(code):
    root_node = parse_code(code)
    symbols = set()

    def visit_node(node):
        if node.type in ('identifier', 'type_identifier', 'field_identifier'):
            symbols.add(node.text.decode('utf-8'))
        for child in node.children:
            visit_node(child)

    visit_node(root_node)
    return symbols
