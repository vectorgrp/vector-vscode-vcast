from functools import lru_cache
import re
import os
from util import paths_to_files
#import tree_sitter_c as tsc
#from tree_sitter import Parser, Language

# Initialize Tree-sitter parser for C++
import tree_sitter_cpp as ts_cpp
from tree_sitter import Parser, Language

# ...existing code...

#C_LANGUAGE = Language(tsc.language())
CXX_LANGUAGE = Language(ts_cpp.language())
parser = Parser(CXX_LANGUAGE)

_IDENTIFIER_BLACKLIST = {'FUNC', 'VAR'}

class Codebase:
    def __init__(self, source_dirs):
        self.source_dirs = source_dirs
        self.parser = parser  # Using the updated C++ parser
        self.codebase_files = self._collect_codebase_files()
        self.include_graph = self._build_include_graph()
        self.inverted_index = self._build_inverted_index()

    def _collect_codebase_files(self):
        return paths_to_files(self.source_dirs, file_extensions=['.c', '.h', '.cpp', '.hpp', '.cc', '.hh'])

    def get_code_bytes(self, filepath):
        with open(filepath, 'rb') as f:
            code_bytes = f.read()
        return self._replace_func_meta(code_bytes)

    def _replace_func_meta(self, code_bytes):
        code_str = code_bytes.decode('utf8', errors='ignore')
        code_str = re.sub(r'FUNC\((\w+)\s*,\s*\w+\)', r'\1', code_str)
        return code_str.encode('utf8')

    @lru_cache(maxsize=4096)
    def parse_file(self, filepath):
        code_bytes = self.get_code_bytes(filepath)
        tree = self.parser.parse(code_bytes)
        return tree, code_bytes

    def _build_inverted_index(self):
        inverted_index = {}
        for filepath in self.codebase_files:
            tree, code_bytes = self.parse_file(filepath)
            root_node = tree.root_node
            self._collect_definitions(root_node, code_bytes, filepath, inverted_index)
        return inverted_index

    def _build_include_graph(self):
        include_graph = {}
        for filepath in self.codebase_files:
            tree, code_bytes = self.parse_file(filepath)
            root_node = tree.root_node
            included_files = self._get_included_files(root_node, filepath)
            include_graph[filepath] = included_files
        return include_graph

    def _collect_definitions(self, node, code_bytes, filepath, inverted_index):
        try:
            names = self._get_definition_names(node)
            if names:
                definition_code = code_bytes[node.start_byte:node.end_byte].decode('utf8', errors='ignore')
                for name in names:
                    if name not in inverted_index:
                        inverted_index[name] = {}
                    inverted_index[name][filepath] = definition_code
            for child in node.children:
                self._collect_definitions(child, code_bytes, filepath, inverted_index)
        except RecursionError:
            print("Recursion error in node:", filepath)

    def _get_definition_names(self, node):
        names = []
        # Function definition
        if node.type == 'function_definition' or node.type == 'function_declaration':
            declarator_parent = node.child_by_field_name('declarator')
            if declarator_parent:
                function_name_node = declarator_parent.child_by_field_name('declarator')
                if function_name_node:
                    names.append(function_name_node.text.decode('utf8'))
        # Class definition
        elif node.type == 'class_specifier':
            class_name_node = node.child_by_field_name('name')
            if class_name_node:
                names.append(class_name_node.text.decode('utf8'))
        # Namespace definition
        elif node.type == 'namespace_definition':
            namespace_name_node = node.child_by_field_name('name')
            if namespace_name_node:
                names.append(namespace_name_node.text.decode('utf8'))
        # Template definition
        elif node.type == 'template_declaration':
            # Handle templates if necessary
            pass
        # Struct definition
        elif node.type == 'struct_specifier':
            struct_name_node = node.child_by_field_name('name')
            if struct_name_node:
                names.append(struct_name_node.text.decode('utf8'))
        # Macro definition
        elif node.type == 'preproc_def':
            macro_name_node = node.child(1)
            if macro_name_node and macro_name_node.type == 'identifier':
                names.append(macro_name_node.text.decode('utf8'))
        # Enum definition and enumerators
        elif node.type == 'enum_specifier':
            enum_name_node = node.child_by_field_name('name')
            if enum_name_node:
                names.append(enum_name_node.text.decode('utf8'))
            enumerator_list = node.child_by_field_name('body')
            if enumerator_list:
                for enumerator in enumerator_list.named_children:
                    if enumerator.type == 'enumerator':
                        enumerator_name_node = enumerator.child_by_field_name('name')
                        if enumerator_name_node:
                            names.append(enumerator_name_node.text.decode('utf8'))
        # Typedef definition
        elif node.type == 'type_definition':
            alias_node = node.child_by_field_name('alias')
            if alias_node:
                names.append(alias_node.text.decode('utf8'))
        # Global variable definition
        if node.type == 'declaration' and node.parent.type == 'translation_unit':
            declarator = node.child_by_field_name('declarator')
            if declarator and declarator.type == 'identifier':
                names.append(declarator.text.decode('utf8'))

        return names

    def _get_definition_node(self, node, identifier=None):
        names = self._get_definition_names(node)
        if identifier and identifier in names:
            return node
        return None

    def find_definition(self, identifier, referencing_file, visited_files=None, only_local=False):
        if visited_files is None:
            visited_files = set()

        if referencing_file in visited_files:
            return None  # Avoid cycles

        visited_files.add(referencing_file)

        # Search for definition in the current file
        definitions_in_file = self.inverted_index.get(identifier, {}).get(referencing_file)
        if definitions_in_file:
            return definitions_in_file

        if only_local:
            return None

        # Use precomputed include graph to find definitions in included files
        included_files = self.include_graph.get(referencing_file, [])
        for inc_filepath in included_files:
            if inc_filepath not in visited_files:
                # Search for definition in the included file
                definitions_in_file = self.inverted_index.get(identifier, {}).get(inc_filepath)
                if definitions_in_file:
                    return definitions_in_file
                # Recursively search in included files
                result = self.find_definition(identifier, inc_filepath, visited_files)
                if result:
                    return result

        # Fallback to all definitions in the codebase
        all_definitions = [defn for defn in self.inverted_index.get(identifier, {}).values()]
        
        return all_definitions[0] if all_definitions else None

    def _get_included_files(self, root_node, current_filepath):
        included_files = []
        for node in root_node.children:
            if node.type == 'preproc_include' or node.type == 'preproc_import':
                include_text = node.text.decode('utf8')
                match = re.match(r'#\s*(include|import)\s*["<](.*?)[">]', include_text)
                if match:
                    include_filename = match.group(2)
                    inc_filepath = self._resolve_include_path(include_filename, current_filepath)
                    if inc_filepath:
                        included_files.append(inc_filepath)
        return included_files

    def _resolve_include_path(self, include_filename, current_filepath):
        current_dir = os.path.dirname(current_filepath)
        # Check relative to current file
        candidate = os.path.join(current_dir, include_filename)
        if os.path.exists(candidate):
            return candidate
        # Check in source directories and their subdirectories
        for source_dir in self.source_dirs:
            for root, _, files in os.walk(source_dir):
                candidate = os.path.join(root, include_filename)
                if os.path.exists(candidate):
                    return candidate
        return None

    def find_functions_in_file(self, filepath):
        tree, code_bytes = self.parse_file(filepath)
        root_node = tree.root_node
        functions = self._find_functions(root_node)
        return [(func_node, code_bytes[func_node.start_byte:func_node.end_byte].decode('utf8')) for func_node in functions]

    def _find_functions(self, node):
        functions = []
        if node.type == 'function_definition':
            functions.append(node)
        for child in node.children:
            functions.extend(self._find_functions(child))
        return functions

    def find_enclosing_function(self, filepath, line_number, window_tolerance=0):
        tree, _ = self.parse_file(filepath)
        root_node = tree.root_node
        return self._find_function_containing_line(root_node, line_number, window_tolerance)

    def _find_function_containing_line(self, node, line_number, window_tolerance):
        if node.type == 'function_definition':
            start_line, _ = node.start_point
            end_line, _ = node.end_point
            if start_line - window_tolerance <= line_number <= end_line + window_tolerance:
                return node
        for child in node.children:
            result = self._find_function_containing_line(child, line_number, window_tolerance)
            if result:
                return result
        return None

    def get_code_window(self, filepath, line_number, window=5, return_line_numbers=False):
        tree, code_bytes = self.parse_file(filepath)
        root_node = tree.root_node

        # Find initial start and end lines for the window
        start_line = max(0, line_number - window)
        end_line = line_number + window

        # Expand window to include entire functions within the window
        functions = self._find_functions_in_range(root_node, start_line, end_line)
        for func_node in functions:
            func_start_line, _ = func_node.start_point
            func_end_line, _ = func_node.end_point
            start_line = min(start_line, func_start_line)
            end_line = max(end_line, func_end_line)

        # Extract code between start_line and end_line
        code_lines = code_bytes.decode('utf8', errors='ignore').splitlines()
        code_window = '\n'.join(code_lines[start_line:end_line + 1])

        if return_line_numbers:
            return code_window, start_line, end_line

        return code_window

    def _find_functions_in_range(self, node, start_line, end_line):
        functions = []
        node_start_line, _ = node.start_point
        node_end_line, _ = node.end_point

        # If node is outside the range, skip it
        if node_end_line < start_line or node_start_line > end_line:
            return functions

        if node.type == 'function_definition':
            functions.append(node)

        for child in node.children:
            functions.extend(self._find_functions_in_range(child, start_line, end_line))

        return functions

    def get_identifiers_in_window(self, filepath, start_line, end_line):
        tree, code_bytes = self.parse_file(filepath)
        root_node = tree.root_node
        identifiers = set()
        self._collect_identifiers_in_range(root_node, start_line, end_line, identifiers)
        return identifiers - _IDENTIFIER_BLACKLIST

    def _collect_identifiers_in_range(self, node, start_line, end_line, identifiers):
        node_start_line, _ = node.start_point
        node_end_line, _ = node.end_point

        # If node is outside the range, skip it
        if node_end_line < start_line or node_start_line > end_line:
            return

        if node.type in ('identifier', 'type_identifier'):
            identifier = node.text.decode('utf8')
            identifiers.add(identifier)

        for child in node.children:
            self._collect_identifiers_in_range(child, start_line, end_line, identifiers)

    def get_all_functions(self):
        functions = []
        for filepath in self.codebase_files:
            tree, code_bytes = self.parse_file(filepath)
            root_node = tree.root_node
            func_nodes = self._find_functions(root_node)
            for func_node in func_nodes:
                declarator = func_node.child_by_field_name('declarator')
                if declarator:
                    func_name_node = declarator.child_by_field_name('declarator')
                    if func_name_node:
                        func_name = func_name_node.text.decode('utf8')
                        start_line = func_node.start_point[0] + 1
                        functions.append({
                            'name': func_name,
                            'file': filepath,
                            'line': start_line
                        })
        return functions
