from typing import List, Dict, Optional, Set, Tuple, Union
from monitors4codegen.multilspy import SyncLanguageServer
from monitors4codegen.multilspy.multilspy_config import MultilspyConfig
from monitors4codegen.multilspy.multilspy_logger import MultilspyLogger
from pathlib import Path
import os
import tree_sitter_cpp as ts_cpp
from tree_sitter import Parser, Language
from copy import deepcopy

class Codebase:
    # All LSP symbol kinds that we want to index
    INDEXABLE_KINDS = {
        12,  # Function
        6,   # Method
        13,  # Variable
        5,   # Class
        23,  # Namespace
        22,  # Struct
        10,  # Enum
        11,   # Interface,
        252  # Type defs
    }
    
    FUNCTION_KINDS = {12, 6}  # Both functions and methods

    def _make_absolute(self, path: str) -> str:
        """Convert a path to absolute path"""
        return str(Path(path).resolve())

    def _find_common_prefix(self, paths: List[str]) -> str:
        """Find the longest common prefix of all paths"""
        if not paths:
            return ""
        abs_paths = [self._make_absolute(p) for p in paths]
        return os.path.commonpath(abs_paths)
    
    def __init__(self, source_dirs: List[str]):
        # Initialize tree-sitter parser
        self.ts_parser = Parser(Language(ts_cpp.language()))
        
        # Convert all source directories to absolute paths
        self.source_dirs = [self._make_absolute(d) for d in source_dirs]
        
        # Find common prefix for LSP server
        common_prefix = self._find_common_prefix(self.source_dirs)
        common_prefix_dir = common_prefix if os.path.isdir(common_prefix) else os.path.dirname(common_prefix)
        
        self.config = MultilspyConfig.from_dict({'code_language': 'cpp'})
        self.logger = MultilspyLogger()
        self.lsp = SyncLanguageServer.create(
            self.config, 
            self.logger, 
            common_prefix_dir
        )

        # Index mapping names to their definitions
        self._definition_index: Dict[str, List[Dict]] = {}
        self._build_definition_index()

    def _build_definition_index(self):
        """Build an index mapping symbol names to their definitions"""
        with self.lsp.start_server():
            for source_dir in self.source_dirs:
                path = Path(source_dir)
                if path.is_file():
                    files = [path]
                else:
                    files = list(path.rglob('*.cpp')) + list(path.rglob('*.c'))
                
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
                            definition_lines = file_content.splitlines()[start_line:end_line + 1]
                            definition_text = '\n'.join(definition_lines)
                            
                            if name not in self._definition_index:
                                self._definition_index[name] = []
                            self._definition_index[name].append({
                                'name': name,
                                'kind': symbol['kind'],
                                'file': abs_file,
                                'line': start_line + 1,
                                'character': symbol['range']['start']['character'],
                                'definition': definition_text
                            })

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
        
        if open_brace_index != -1 and close_brace_index != -1 and open_brace_index < close_brace_index:
            # Keep everything up to the opening brace and after the closing brace
            return definition_text[:open_brace_index + 1] + ' ... ' + definition_text[close_brace_index:]
        
        return definition_text

    def get_all_functions(self, only_with_body: bool = True, collapse_function_body: bool = False) -> List[Dict]:
        """Get all functions and methods from all files in the codebase"""
        functions = [
            def_info for defs in self._definition_index.values()
            for def_info in defs
            if def_info['kind'] in self.FUNCTION_KINDS
        ]
        
        if only_with_body:
            functions = [
                f for f in functions
                if self._has_function_body(f['definition'])
            ]
        
        if collapse_function_body:
            # Create deep copies to avoid mutating original data
            functions = deepcopy(functions)
            for func in functions:
                func['definition'] = self._collapse_function_body(func['definition'])
        
        return functions

    def get_functions_in_file(self, filepath: str, only_with_body: bool = True, collapse_function_body: bool = False) -> List[Dict]:
        """Get all functions and methods from a specific file"""
        abs_path = self._make_absolute(filepath)
        functions = [
            def_info for defs in self._definition_index.values()
            for def_info in defs
            if def_info['kind'] in self.FUNCTION_KINDS and def_info['file'] == abs_path
        ]
        
        if only_with_body:
            functions = [
                f for f in functions
                if self._has_function_body(f['definition'])
            ]
        
        if collapse_function_body:
            # Create deep copies to avoid mutating original data
            functions = deepcopy(functions)
            for func in functions:
                func['definition'] = self._collapse_function_body(func['definition'])
        
        return functions

    def find_definitions_by_name(self, identifier: str, collapse_function_body: bool = False) -> List[str]:
        """Find all definitions of an identifier by name, returns the actual definition text"""
        definitions = self._definition_index.get(identifier, [])
        if collapse_function_body:
            return [self._collapse_function_body(d['definition']) if d['kind'] in self.FUNCTION_KINDS else d['definition'] for d in definitions]

        return [d['definition'] for d in definitions]

    def find_definition_by_location(self, referencing_file: str, line: int, character: int, collapse_function_body: bool = False) -> Optional[str]:
        """Find definition of an identifier at a specific location"""
        with self.lsp.start_server():
            definition = self.lsp.request_definition(
                referencing_file,
                line,
                character
            )
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
                definition_lines = file_content.splitlines()[start_line:end_line + 1]
                definition_text = '\n'.join(definition_lines)
                
                if collapse_function_body and definition['kind'] in self.FUNCTION_KINDS:
                    return self._collapse_function_body(definition_text)
                
                return definition_text
                    
        return None

    def _get_symbol_references_in_window(self, code_bytes: bytes, start_line: int, end_line: int) -> Set[str]:
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

    def get_definitions_for_window(self, filepath: str, start_line: int, end_line: int, collapse_function_body: bool = False, return_dict: bool = False) -> Union[List[str], Dict[str, List[str]]]:
        """Get definitions for all symbols referenced in a window of code"""
        abs_path = self._make_absolute(filepath)
        
        # Read the file content
        with open(abs_path, 'rb') as f:
            code_bytes = f.read()
            
        # Get all symbol references in the window
        symbols = self._get_symbol_references_in_window(code_bytes, start_line, end_line)
        
        if return_dict:
            # Return dictionary mapping symbols to their definitions
            definitions = {}
            for symbol in symbols:
                symbol_definitions = self.find_definitions_by_name(symbol, collapse_function_body)
                if symbol_definitions:  # Only include symbols that have definitions
                    definitions[symbol] = symbol_definitions[0]
            return definitions
        else:
            # Return flat list of all definitions
            definitions = []
            for symbol in symbols:
                symbol_definitions = self.find_definitions_by_name(symbol, collapse_function_body)
                definitions.append(symbol_definitions[0])
            return definitions

    def get_definitions_for_function(self, filepath: str, function_name: str, collapse_function_body: bool = False, return_dict: bool = False) -> Union[List[str], Dict[str, List[str]]]:
        """Get definitions for all symbols referenced in a function"""
        abs_path = self._make_absolute(filepath)
        
        # Find the function definition
        functions = self.get_functions_in_file(abs_path)
        target_function = None
        for func in functions:
            if func['name'] == function_name:
                target_function = func
                break
                
        if not target_function:
            return {} if return_dict else []
            
        # Get the function's line range
        line = target_function['line']
        # Calculate end line by counting lines in definition
        end_line = line + len(target_function['definition'].splitlines()) - 1
        
        # Use the window-based definition lookup
        return self.get_definitions_for_window(filepath, line - 1, end_line, collapse_function_body, return_dict)
