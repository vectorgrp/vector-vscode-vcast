from __future__ import annotations
import typing as t
import re
import glob
import os
from typing import List
import platform
from tree_sitter import Language, Parser
import tree_sitter_cpp as ts_cpp

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
        lines = string.split('\n')
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


def get_executable_statement_groups(code: str) -> List[List[int]]:
    """
    Extract executable statement groups from code using tree-sitter.
    Returns a list of lists, where each inner list contains line numbers of statements
    that belong to the same execution path.
    """
    root_node = parse_code(code)

    # print(root_node.sexp())

    COLLECTED_NODE_TYPES = [
        'expression_statement',
        'return_statement',
        'throw_statement',
        'break_statement',
        'continue_statement',
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

    class CollectedNode(BaseModel):
        line_number: int
        path: List[str]
        symbols: List[str]

    class StatementGroup(BaseModel):
        line_numbers: List[int]
        path: List[str]
        symbols: List[str]

        @property
        def lines(self):
            lines = code.split('\n')
            return [lines[i] for i in self.line_numbers]

        def __str__(self):
            # First, construct the path
            path_str = '\n -> '.join(self.path)

            # Then, construct the lines. For non-adajcent lines, add ...
            lines_str = ''
            for i, line in enumerate(self.lines):
                if i > 0 and self.line_numbers[i] != self.line_numbers[i - 1] + 1:
                    lines_str += '...\n'
                lines_str += f'{line}\n'

            return f'Path: {path_str}\nLines:\n{lines_str}'

        @staticmethod
        def from_collected_nodes(collected_nodes):
            return StatementGroup(
                line_numbers=[node.line_number for node in collected_nodes],
                path=collected_nodes[0].path,
                symbols=list(
                    set(symbol for node in collected_nodes for symbol in node.symbols)
                ),
            )

    # Function to collect statements by execution path
    def collect_statements(node, curr_path):
        curr_path = curr_path.copy()
        """
        if node.type in ('comment', 'preprocessor_directive', 'string_literal'):
            return None
        """

        # Check if this is a statement that should be collected
        if node.type in COLLECTED_NODE_TYPES:
            # Add the line number to the current group
            line_number = node.start_point[0]
            symbols = set()

            def visit_node(node):
                if node.type in ('identifier', 'type_identifier', 'field_identifier'):
                    symbols.add(node.text.decode('utf-8'))
                for child in node.children:
                    visit_node(child)

            visit_node(node)
            return CollectedNode(
                line_number=line_number, path=curr_path, symbols=list(symbols)
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

        groups = []
        # Recursively process other nodes
        for child in node.children:
            # Check if this child is a condition part
            field_name = next(
                (
                    field
                    for field in PATH_NODE_CHILD_PATH_LABELS.get(node.type, {})
                    if node.child_by_field_name(field) == child
                ),
                None,
            )
            path_label = path_labels.get(field_name, None) or path_labels.get('*', None)

            if path_label:
                new_path = [*curr_path, path_label]
            else:
                new_path = curr_path

            groups.append(collect_statements(child, new_path))

        return groups

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

                groups[-1].append(item)
                last_was_list = False

        return groups

    flat_groups = to_flat_groups(executable_groups)
    executable_groups = [
        StatementGroup.from_collected_nodes(group) for group in flat_groups
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

    all_groups = get_executable_statement_groups(function_body)

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
    vectorcast_dir = os.environ.get('VECTORCAST_DIR', '')
    is_windows = platform.system() == 'Windows'
    sep = '\\' if is_windows else '/'
    exe_ext = '.exe' if is_windows else ''

    exe_path = f'{vectorcast_dir}{sep}{executable}{exe_ext}'
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
