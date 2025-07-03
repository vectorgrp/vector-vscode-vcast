from functools import lru_cache
from typing import List, Dict, Optional, Set, Union
from autoreq.constants import SOURCE_FILE_EXTENSIONS
from autoreq.util import are_paths_equal
from monitors4codegen.multilspy import SyncLanguageServer
from monitors4codegen.multilspy.multilspy_config import MultilspyConfig
from monitors4codegen.multilspy.multilspy_logger import MultilspyLogger
from pathlib import Path
import os
import tree_sitter_cpp as ts_cpp
from tree_sitter import Parser, Language, Tree
from copy import deepcopy
import logging

logger = logging.getLogger(__name__)

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
        logger.debug(
            f'Initializing Codebase with {len(source_dirs)} source directories: {[os.path.basename(d) for d in source_dirs]}'
        )

        # Initialize tree-sitter parser
        logger.debug('Setting up tree-sitter parser for C/C++')
        self.ts_parser = Parser()
        CPP_LANGUAGE = Language(ts_cpp.language(), 'cpp')
        self.ts_parser.set_language(CPP_LANGUAGE)

        # Convert all source directories to absolute paths
        self.source_dirs = [self._make_absolute(d) for d in source_dirs]
        logger.debug(
            f'Converted to absolute paths: {len(self.source_dirs)} directories'
        )

        # Find common prefix for LSP server
        common_prefix = self._find_common_prefix(self.source_dirs)
        common_prefix_dir = (
            common_prefix
            if os.path.isdir(common_prefix)
            else os.path.dirname(common_prefix)
        )
        logger.debug(f'Common prefix directory for LSP: {common_prefix_dir}')

        self.config = MultilspyConfig.from_dict(
            {
                'code_language': 'c',
                'trace_lsp_communication': True,
            }
        )  # Uses clangd for C/C++. code_language cpp chooses ccls instead.
        self.logger = MultilspyLogger()

        logger.debug('Creating SyncLanguageServer')
        self.lsp = SyncLanguageServer.create(
            self.config, self.logger, common_prefix_dir
        )

        # Index mapping names to their definitions
        self._definition_index: Dict[str, List[Dict]] = {}
        logger.debug('Starting definition index construction')
        self._build_definition_index()
        logger.info(
            f'Definition index built with {len(self._definition_index)} unique symbols'
        )

        # Cache for file contents
        self._file_content_cache = {}

    def _is_blacklisted(self, filepath: str) -> bool:
        """Check if the filepath contains any blacklisted directory"""
        path = Path(filepath)
        return any(black_dir in path.parts for black_dir in BLACKLISTED_DIRS)

    def _build_definition_index(self):
        """Build an index mapping symbol names to their definitions"""
        logger.debug('Building definition index...')
        total_files_processed = 0
        total_symbols_found = 0

        with self.lsp.start_server():
            logger.debug('LSP server started successfully')

            for i, source_dir in enumerate(self.source_dirs):
                logger.debug(
                    f'Processing source directory {i + 1}/{len(self.source_dirs)}: {os.path.basename(source_dir)}'
                )
                path = Path(source_dir)

                if path.is_file():
                    files = [path] if not self._is_blacklisted(str(path)) else []
                    logger.debug(
                        f'Single file provided: {"included" if files else "blacklisted"}'
                    )
                else:
                    files = []
                    for pattern in ['*.' + ext for ext in SOURCE_FILE_EXTENSIONS]:
                        pattern_files = list(path.rglob(pattern))
                        non_blacklisted = [
                            f for f in pattern_files if not self._is_blacklisted(str(f))
                        ]
                        files.extend(non_blacklisted)
                        logger.debug(
                            f'Pattern {pattern}: found {len(pattern_files)} files, {len(non_blacklisted)} after filtering'
                        )

                logger.debug(
                    f'Total files to process in {os.path.basename(source_dir)}: {len(files)}'
                )

                for j, file in enumerate(files):
                    abs_file = self._make_absolute(str(file))
                    logger.debug(
                        f'Processing file {j + 1}/{len(files)}: {os.path.basename(abs_file)}'
                    )

                    try:
                        with open(
                            abs_file, 'r', encoding='utf-8', errors='ignore'
                        ) as f:
                            file_content = f.read()
                            lines = file_content.splitlines()

                        logger.debug(f'File read successfully: {len(lines)} lines')

                        symbols = self.lsp.request_document_symbols(abs_file)
                        if symbols and isinstance(symbols, tuple):
                            symbols = symbols[0]

                        file_symbols_count = 0
                        indexable_symbols_count = 0

                        for symbol in symbols or []:
                            file_symbols_count += 1
                            if symbol.get('kind') in self.INDEXABLE_KINDS:
                                indexable_symbols_count += 1
                                qualified_name = '::'.join(
                                    symbol['namespaces'] + [symbol['name']]
                                )
                                unqualified_name = symbol['name']
                                start_line = symbol['range']['start']['line']
                                end_line = symbol['range']['end']['line']

                                # Extract the actual definition text
                                definition_lines = lines[start_line : end_line + 1]
                                definition_text = '\n'.join(definition_lines)

                                for name in {
                                    qualified_name,
                                    unqualified_name,
                                }:
                                    if name not in self._definition_index:
                                        self._definition_index[name] = []
                                    self._definition_index[name].append(
                                        {
                                            'name': qualified_name,
                                            'unqualified_name': unqualified_name,
                                            'kind': symbol['kind'],
                                            'file': abs_file,
                                            'start_line': start_line,
                                            'end_line': end_line,
                                            'definition': definition_text,
                                        }
                                    )

                        logger.debug(
                            f'File processed: {file_symbols_count} total symbols, {indexable_symbols_count} indexable'
                        )
                        total_symbols_found += indexable_symbols_count
                        total_files_processed += 1

                    except Exception as e:
                        logger.error(
                            f'Failed to process file {os.path.basename(abs_file)}: {e}'
                        )

        # Now reverse the order of the definitions to make sure that the most recent definition is used
        # TODO: Implement a better way to deal with multiple definitions
        multi_def_count = 0
        for name, definitions in self._definition_index.items():
            if len(definitions) > 1:
                multi_def_count += 1
            self._definition_index[name] = list(reversed(definitions))

        logger.info('Definition index construction complete:')
        logger.info(f'  - Files processed: {total_files_processed}')
        logger.info(f'  - Total symbols indexed: {total_symbols_found}')
        logger.info(f'  - Unique symbol names: {len(self._definition_index)}')
        logger.info(f'  - Symbols with multiple definitions: {multi_def_count}')

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
        logger.debug(
            f'Getting all functions (only_with_body={only_with_body}, collapse_function_body={collapse_function_body})'
        )

        functions = [
            def_info
            for defs in self._definition_index.values()
            for def_info in defs
            if def_info['kind'] in self.FUNCTION_KINDS
        ]
        logger.debug(f'Found {len(functions)} total functions/methods')

        if only_with_body:
            functions_with_body = [
                f for f in functions if self._has_function_body(f['definition'])
            ]
            logger.debug(
                f'Filtered to {len(functions_with_body)} functions with body (removed {len(functions) - len(functions_with_body)} declarations)'
            )
            functions = functions_with_body

        if collapse_function_body:
            logger.debug('Collapsing function bodies')
            # Create deep copies to avoid mutating original data
            functions = deepcopy(functions)
            for func in functions:
                func['definition'] = self._collapse_function_body(func['definition'])

        logger.debug(f'Returning {len(functions)} functions')
        return functions

    def get_functions_in_file(
        self,
        filepath: str,
        only_with_body: bool = True,
        collapse_function_body: bool = False,
    ) -> List[Dict]:
        """Get all functions and methods from a specific file"""
        abs_path = self._make_absolute(filepath)
        logger.debug(
            f'Getting functions in file: {os.path.basename(abs_path)} (only_with_body={only_with_body}, collapse_function_body={collapse_function_body})'
        )

        functions = [
            def_info
            for defs in self._definition_index.values()
            for def_info in defs
            if def_info['kind'] in self.FUNCTION_KINDS
            and are_paths_equal(def_info['file'], abs_path)
        ]
        logger.debug(f'Found {len(functions)} total functions/methods in file')

        if only_with_body:
            functions_with_body = [
                f for f in functions if self._has_function_body(f['definition'])
            ]
            logger.debug(f'Filtered to {len(functions_with_body)} functions with body')
            functions = functions_with_body

        if collapse_function_body:
            logger.debug('Collapsing function bodies')
            # Create deep copies to avoid mutating original data
            functions = deepcopy(functions)
            for func in functions:
                func['definition'] = self._collapse_function_body(func['definition'])

        logger.debug(f'Returning {len(functions)} functions from file')
        return functions

    def find_definitions_by_name(
        self,
        identifier: str,
        collapse_function_body: bool = False,
        filepath: Optional[str] = None,
        return_raw: bool = False,
    ) -> List[str]:
        """Find all definitions of an identifier by name, returns the actual definition text"""
        logger.debug(
            f"Finding definitions for identifier: '{identifier}' (collapse_function_body={collapse_function_body}, filepath={os.path.basename(filepath) if filepath else None}, return_raw={return_raw})"
        )

        definitions = self._definition_index.get(identifier, [])
        logger.debug(f"Found {len(definitions)} definitions for '{identifier}'")

        if collapse_function_body:
            logger.debug('Collapsing function bodies in definitions')
            definitions = deepcopy(definitions)
            collapsed_count = 0
            for d in definitions:
                if d['kind'] in self.FUNCTION_KINDS:
                    d['definition'] = self._collapse_function_body(d['definition'])
                    collapsed_count += 1
            logger.debug(f'Collapsed {collapsed_count} function bodies')

        if return_raw:
            logger.debug(f'Returning raw definitions: {len(definitions)} items')
            return definitions

        if filepath:
            abs_filepath = self._make_absolute(filepath)
            original_count = len(definitions)
            definitions = [
                d
                for d in definitions
                if are_paths_equal(self._make_absolute(d['file']), abs_filepath)
            ]
            logger.debug(
                f'Filtered by filepath: {len(definitions)} definitions (removed {original_count - len(definitions)})'
            )

        result = [d['definition'] for d in definitions]
        logger.debug(f'Returning {len(result)} definition texts')
        return result

    def find_definition_by_location(
        self,
        referencing_file: str,
        line: int,
        character: int,
        collapse_function_body: bool = False,
    ) -> Optional[str]:
        """Find definition of an identifier at a specific location"""
        logger.debug(
            f'Finding definition by location: {os.path.basename(referencing_file)}:{line}:{character} (collapse_function_body={collapse_function_body})'
        )

        with self.lsp.start_server():
            try:
                definition = self.lsp.request_definition(
                    referencing_file, line, character
                )
                if definition and isinstance(definition, tuple):
                    definition = definition[0]
                if isinstance(definition, list):
                    definition = definition[0]

                if definition:
                    logger.debug('Definition found via LSP')
                    # Get the file content and extract the definition text
                    target_file = definition['absolutePath']
                    logger.debug(f'Target file: {os.path.basename(target_file)}')

                    with open(target_file, 'r', encoding='utf-8', errors='ignore') as f:
                        file_content = f.read()

                    start_line = definition['range']['start']['line']
                    end_line = definition['range']['end']['line']
                    definition_lines = file_content.splitlines()[
                        start_line : end_line + 1
                    ]
                    definition_text = '\n'.join(definition_lines)

                    logger.debug(
                        f'Extracted definition: lines {start_line}-{end_line}, {len(definition_text)} characters'
                    )

                    if (
                        collapse_function_body
                        and definition['kind'] in self.FUNCTION_KINDS
                    ):
                        logger.debug('Collapsing function body')
                        return self._collapse_function_body(definition_text)

                    return definition_text
                else:
                    logger.debug('No definition found via LSP')
            except Exception as e:
                logger.error(f'LSP definition request failed: {e}')

        return None

    @lru_cache(maxsize=32)  # Cache for parsed trees
    def _get_parsed_tree(self, code_bytes: bytes) -> Tree:
        """Parses code bytes and returns the Tree-sitter tree, cached."""
        return self.ts_parser.parse(code_bytes)

    @lru_cache(maxsize=32)  # Cache for symbol extraction from a window of a parsed tree
    def _get_symbol_references_in_window(
        self, code_bytes: bytes, start_line: int, end_line: int
    ) -> Set[str]:
        """Extract all potential symbol references in a given window of code using tree-sitter"""
        tree = self._get_parsed_tree(code_bytes)  # Use cached tree
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

    @lru_cache(maxsize=32)  # Cache for file contents
    def _read_file_bytes(self, filepath: str) -> bytes:
        """Reads and caches file content in bytes."""
        with open(filepath, 'rb') as f:
            return f.read()

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
        logger.debug(
            f'Getting definitions for window: {os.path.basename(abs_path)}:{start_line}-{end_line} (depth={depth}, collapse_function_body={collapse_function_body}, return_dict={return_dict})'
        )

        # Read the file content using the cached method
        code_bytes = self._read_file_bytes(abs_path)
        logger.debug(f'File content loaded: {len(code_bytes)} bytes')

        definitions = self._get_definitions_for_window(
            code_bytes, start_line, end_line, collapse_function_body, depth
        )
        logger.debug(f'Found definitions for {len(definitions)} symbols')

        # Sort them by line number
        definitions = {
            k: v
            for k, v in sorted(
                definitions.items(), key=lambda item: item[1]['start_line']
            )
        }
        logger.debug('Definitions sorted by line number')

        if return_dict:
            result = {k: v['definition'] for k, v in definitions.items()}
            logger.debug(f'Returning dictionary with {len(result)} symbol definitions')
            return result

        unique_definitions = list(set(v['definition'] for v in definitions.values()))
        logger.debug(f'Returning {len(unique_definitions)} unique definitions')
        return unique_definitions

    def _get_definitions_for_window(
        self,
        code_bytes: bytes,
        start_line: int,
        end_line: int,
        collapse_function_body: bool = False,
        depth=1,
    ) -> Dict[str, List[str]]:
        """Get definitions for all symbols referenced in a window of code"""
        logger.debug(
            f'Internal window processing: lines {start_line}-{end_line}, depth={depth}'
        )

        # Get all symbol references in the window
        symbols = self._get_symbol_references_in_window(
            code_bytes, start_line, end_line
        )
        logger.debug(f'Found {len(symbols)} symbol references in window')

        # Return dictionary mapping symbols to their definitions
        definitions = {}
        symbols_with_definitions = 0
        recursive_definitions = 0

        for symbol in symbols:
            symbol_definitions = self.find_definitions_by_name(
                symbol, collapse_function_body, return_raw=True
            )
            if symbol_definitions:
                symbols_with_definitions += 1
                definition = symbol_definitions[0]

                if depth > 1:
                    # Recursively get definitions for symbols in the definition
                    recursive_defs = self._get_definitions_for_window(
                        code_bytes,
                        definition['start_line'],
                        definition['end_line'],
                        collapse_function_body,
                        depth - 1,
                    )
                    definitions.update(recursive_defs)
                    recursive_definitions += len(recursive_defs)

                definitions[symbol] = definition

        logger.debug(
            f'Window processing complete: {symbols_with_definitions}/{len(symbols)} symbols have definitions'
        )
        if depth > 1:
            logger.debug(
                f'Recursive processing added {recursive_definitions} additional definitions'
            )

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
        logger.debug(
            f"Getting definitions for symbol: '{symbol_name}' (filepath={os.path.basename(filepath) if filepath else None}, depth={depth}, collapse_function_body={collapse_function_body}, return_dict={return_dict})"
        )

        definitions = self.find_definitions_by_name(
            symbol_name, collapse_function_body, return_raw=True
        )
        logger.debug(f"Found {len(definitions)} definitions for symbol '{symbol_name}'")

        target = None
        if filepath is None:
            if len(definitions) > 0:
                target = definitions[0]
                filepath = self._make_absolute(target['file'])
                logger.debug(
                    f'Using first definition from file: {os.path.basename(filepath)}'
                )
        else:
            abs_filepath = self._make_absolute(filepath)
            target = next(
                (
                    d
                    for d in definitions
                    if are_paths_equal(self._make_absolute(d['file']), abs_filepath)
                ),
                None,
            )
            if target:
                logger.debug(
                    f'Found definition in specified file: {os.path.basename(abs_filepath)}'
                )
            else:
                logger.debug(
                    f'No definition found in specified file: {os.path.basename(abs_filepath)}'
                )

        if not target:
            logger.debug('No target definition found, returning empty result')
            return {} if return_dict else []

        start_line = target['start_line']
        end_line = target['end_line']
        logger.debug(f'Target definition spans lines {start_line}-{end_line}')

        # Use the window-based definition lookup
        return self.get_definitions_for_window(
            filepath, start_line, end_line, depth, collapse_function_body, return_dict
        )
