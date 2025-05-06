from functools import lru_cache
from typing import List, Dict, Optional, Set, Tuple, Union
from monitors4codegen.multilspy import SyncLanguageServer
from monitors4codegen.multilspy.multilspy_config import MultilspyConfig
from monitors4codegen.multilspy.multilspy_logger import MultilspyLogger
from pathlib import Path
import os
import tree_sitter_cpp as ts_cpp
from tree_sitter import Parser, Language
from copy import deepcopy

BLACKLISTED_DIRS = ['.ccls-cache']


class Codebase:
    # All LSP symbol kinds that we want to index
    INDEXABLE_KINDS = {
        12,  # Function#
        6,  # Method
        5,  # Class
        9,  # Constructor
        13,  # Variable
        14,  # Constant
        23,  # Struct
        10,  # Enum
        11,  # Interface,
        26,  # Type parameter
    }

    FUNCTION_KINDS = {12, 6}  # Both functions and methods

    def _make_absolute(self, path: str) -> str:
        """Convert a path to absolute path"""
        return str(Path(path).resolve())

    def _find_common_prefix(self, paths: List[str]) -> str:
        """Find the longest common prefix of all paths"""
        if not paths:
            return ''
        abs_paths = [self._make_absolute(p) for p in paths]
        return os.path.commonpath(abs_paths)

    def __init__(self, source_dirs: List[str]):
        # Initialize tree-sitter parser
        self.ts_parser = Parser()
        CPP_LANGUAGE = Language(ts_cpp.language(), 'cpp')
        self.ts_parser.set_language(CPP_LANGUAGE)

        # Convert all source directories to absolute paths
        self.source_dirs = [self._make_absolute(d) for d in source_dirs]

        # Find common prefix for LSP server
        common_prefix = self._find_common_prefix(self.source_dirs)
        common_prefix_dir = (
            common_prefix
            if os.path.isdir(common_prefix)
            else os.path.dirname(common_prefix)
        )

        self.config = MultilspyConfig.from_dict(
            {'code_language': 'c'}
        )  # Uses clangd for C/C++. code_language cpp chooses ccls instead.
        self.logger = MultilspyLogger()
        self.lsp = SyncLanguageServer.create(
            self.config, self.logger, common_prefix_dir
        )

        # Index mapping names to their definitions
        self._definition_index: Dict[str, List[Dict]] = {}
        self._build_definition_index()

    def _is_blacklisted(self, filepath: str) -> bool:
        """Check if the filepath contains any blacklisted directory"""
        path = Path(filepath)
        return any(black_dir in path.parts for black_dir in BLACKLISTED_DIRS)

    def _build_definition_index(self):
        """Build an index mapping symbol names to their definitions"""
        with self.lsp.start_server():
            for source_dir in self.source_dirs:
                path = Path(source_dir)
                if path.is_file():
                    files = [path] if not self._is_blacklisted(str(path)) else []
                else:
                    files = []
                    for pattern in ['*.cpp', '*.c']:
                        for file in path.rglob(pattern):
                            if not self._is_blacklisted(str(file)):
                                files.append(file)

                for file in files:
                    abs_file = self._make_absolute(str(file))
                    with open(abs_file, 'r', encoding='utf-8', errors='ignore') as f:
                        file_content = f.read()

                    symbols = self.lsp.request_document_symbols(abs_file)
                    if symbols and isinstance(symbols, tuple):
                        symbols = symbols[0]

                    for symbol in symbols or []:
                        if symbol.get('kind') in self.INDEXABLE_KINDS:
                            name = symbol['name']
                            start_line = symbol['range']['start']['line']
                            end_line = symbol['range']['end']['line']

                            # Extract the actual definition text
                            definition_lines = file_content.splitlines()[
                                start_line : end_line + 1
                            ]
                            definition_text = '\n'.join(definition_lines)

                            if name not in self._definition_index:
                                self._definition_index[name] = []
                            self._definition_index[name].append(
                                {
                                    'name': name,
                                    'kind': symbol['kind'],
                                    'file': abs_file,
                                    'start_line': start_line,
                                    'end_line': end_line,
                                    'definition': definition_text,
                                }
                            )

        # Now reverse the order of the definitions to make sure that the most recent definition is used
        # TODO: Implement a better way to deal with multiple definitions
        for name, definitions in self._definition_index.items():
            self._definition_index[name] = list(reversed(definitions))

    def _has_function_body(self, definition_text: str) -> bool:
        """Check if a function definition contains a body (implementation)"""
        # Remove any trailing semicolon and whitespace
        definition_text = definition_text.strip().rstrip(';')
        # Check if it contains curly braces (indicating a body)
        return '{' in definition_text and '}' in definition_text

    def _collapse_function_body(self, definition_text: str) -> str:
        """Remove the body of a function definition"""
        # Find the opening and closing braces
        open_brace_index = definition_text.find('{')
        close_brace_index = definition_text.rfind('}')

        if (
            open_brace_index != -1
            and close_brace_index != -1
            and open_brace_index < close_brace_index
        ):
            # Keep everything up to the opening brace and after the closing brace
            return (
                definition_text[: open_brace_index + 1]
                + ' ... '
                + definition_text[close_brace_index:]
            )

        return definition_text

    def get_all_functions(
        self, only_with_body: bool = True, collapse_function_body: bool = False
    ) -> List[Dict]:
        """Get all functions and methods from all files in the codebase"""
        functions = [
            def_info
            for defs in self._definition_index.values()
            for def_info in defs
            if def_info['kind'] in self.FUNCTION_KINDS
        ]

        if only_with_body:
            functions = [
                f for f in functions if self._has_function_body(f['definition'])
            ]

        if collapse_function_body:
            # Create deep copies to avoid mutating original data
            functions = deepcopy(functions)
            for func in functions:
                func['definition'] = self._collapse_function_body(func['definition'])

        return functions

    def get_functions_in_file(
        self,
        filepath: str,
        only_with_body: bool = True,
        collapse_function_body: bool = False,
    ) -> List[Dict]:
        """Get all functions and methods from a specific file"""
        abs_path = self._make_absolute(filepath)
        functions = [
            def_info
            for defs in self._definition_index.values()
            for def_info in defs
            if def_info['kind'] in self.FUNCTION_KINDS
            and Path(def_info['file']) == Path(abs_path)
        ]

        if only_with_body:
            functions = [
                f for f in functions if self._has_function_body(f['definition'])
            ]

        if collapse_function_body:
            # Create deep copies to avoid mutating original data
            functions = deepcopy(functions)
            for func in functions:
                func['definition'] = self._collapse_function_body(func['definition'])

        return functions

    def find_definitions_by_name(
        self,
        identifier: str,
        collapse_function_body: bool = False,
        return_raw: bool = False,
    ) -> List[str]:
        """Find all definitions of an identifier by name, returns the actual definition text"""
        definitions = self._definition_index.get(identifier, [])

        if collapse_function_body:
            definitions = deepcopy(definitions)
            for d in definitions:
                if d['kind'] in self.FUNCTION_KINDS:
                    d['definition'] = self._collapse_function_body(d['definition'])

        if return_raw:
            return definitions

        return [d['definition'] for d in definitions]

    def find_definition_by_location(
        self,
        referencing_file: str,
        line: int,
        character: int,
        collapse_function_body: bool = False,
    ) -> Optional[str]:
        """Find definition of an identifier at a specific location"""
        with self.lsp.start_server():
            definition = self.lsp.request_definition(referencing_file, line, character)
            if definition and isinstance(definition, tuple):
                definition = definition[0]
            if isinstance(definition, list):
                definition = definition[0]

            if definition:
                # Get the file content and extract the definition text
                target_file = definition['absolutePath']
                with open(target_file, 'r', encoding='utf-8', errors='ignore') as f:
                    file_content = f.read()

                start_line = definition['range']['start']['line']
                end_line = definition['range']['end']['line']
                definition_lines = file_content.splitlines()[start_line : end_line + 1]
                definition_text = '\n'.join(definition_lines)

                if collapse_function_body and definition['kind'] in self.FUNCTION_KINDS:
                    return self._collapse_function_body(definition_text)

                return definition_text

        return None

    def _get_symbol_references_in_window(
        self, code_bytes: bytes, start_line: int, end_line: int
    ) -> Set[str]:
        """Extract all potential symbol references in a given window of code using tree-sitter"""
        tree = self.ts_parser.parse(code_bytes)
        root_node = tree.root_node
        symbols = set()

        def visit_node(node):
            if node.type in ('identifier', 'type_identifier', 'field_identifier'):
                node_start_line = node.start_point[0]
                if start_line <= node_start_line <= end_line:
                    symbols.add(node.text.decode('utf-8'))
            for child in node.children:
                visit_node(child)

        visit_node(root_node)
        return symbols

    def get_definitions_for_window(
        self,
        filepath: str,
        start_line: int,
        end_line: int,
        depth=1,
        collapse_function_body: bool = False,
        return_dict: bool = False,
    ) -> Union[List[str], Dict[str, List[str]]]:
        """Get definitions for all symbols referenced in a window of code"""
        abs_path = self._make_absolute(filepath)

        # Read the file content
        with open(abs_path, 'rb') as f:
            code_bytes = f.read()

        definitions = self._get_definitions_for_window(
            code_bytes, start_line, end_line, collapse_function_body, depth
        )

        # Sort them by line number
        definitions = {
            k: v
            for k, v in sorted(
                definitions.items(), key=lambda item: item[1]['start_line']
            )
        }

        if return_dict:
            return {k: v['definition'] for k, v in definitions.items()}

        return list(set(v['definition'] for v in definitions.values()))

    def _get_definitions_for_window(
        self,
        code_bytes: bytes,
        start_line: int,
        end_line: int,
        collapse_function_body: bool = False,
        depth=1,
    ) -> Dict[str, List[str]]:
        """Get definitions for all symbols referenced in a window of code"""
        # Get all symbol references in the window
        symbols = self._get_symbol_references_in_window(
            code_bytes, start_line, end_line
        )

        # Return dictionary mapping symbols to their definitions
        definitions = {}
        for symbol in symbols:
            symbol_definitions = self.find_definitions_by_name(
                symbol, collapse_function_body, return_raw=True
            )
            if symbol_definitions:
                definition = symbol_definitions[0]

                if depth > 1:
                    # Recursively get definitions for symbols in the definition
                    symbol_definitions = self._get_definitions_for_window(
                        code_bytes,
                        definition['start_line'],
                        definition['end_line'],
                        collapse_function_body,
                        depth - 1,
                    )
                    definitions.update(symbol_definitions)

                definitions[symbol] = definition

        return definitions

    @lru_cache(maxsize=128)
    def get_definitions_for_symbol(
        self,
        symbol_name: str,
        filepath=None,
        depth=1,
        collapse_function_body: bool = False,
        return_dict: bool = False,
    ) -> Union[List[str], Dict[str, List[str]]]:
        """Get definitions for all symbols referenced in the definition of a symbol"""
        definitions = self.find_definitions_by_name(
            symbol_name, collapse_function_body, return_raw=True
        )

        target = None
        if filepath is None:
            if len(definitions) > 0:
                target = definitions[0]
                filepath = self._make_absolute(target['file'])
        else:
            abs_filepath = self._make_absolute(filepath)
            target = next(
                (
                    d
                    for d in definitions
                    if Path(self._make_absolute(d['file'])) == Path(abs_filepath)
                ),
                None,
            )

        if not target:
            return {} if return_dict else []

        start_line = target['start_line']
        end_line = target['end_line']

        # Use the window-based definition lookup
        return self.get_definitions_for_window(
            filepath, start_line, end_line, depth, collapse_function_body, return_dict
        )
