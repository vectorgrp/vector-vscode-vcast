class ContextBuilder:
    def __init__(self, codebase, requirement_references):
        self.codebase = codebase
        self.requirement_references = requirement_references

    def build_code_context(self, requirement_id):
        context = ""

        # Step 1: Include files where the requirement is referenced
        referenced_files = set()
        for ref in self.requirement_references:
            if ref.id == requirement_id:
                referenced_files.add(ref.file)

        print(referenced_files)

        for filepath in referenced_files:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                file_content = f.read()
                context += f"\nFile: {filepath}\n{file_content}\n"

        # Step 2: Find identifiers near requirement references
        identifiers_to_include = set()
        for ref in self.requirement_references:
            if ref.id == requirement_id:
                filepath = ref.file
                line_number = ref.line
                # Use the get_identifiers_near_line method from Codebase
                identifiers = self.codebase.get_identifiers_near_line(filepath, line_number, window=5)
                identifiers_to_include.update(identifiers)

                # Check if the reference is inside a function
                function_node = self.codebase.find_enclosing_function(filepath, line_number, window_tolerance=5)
                if function_node:
                    # Extract all identifiers from the function
                    function_identifiers = self.codebase.extract_identifiers(function_node)
                    identifiers_to_include.update(function_identifiers)

        print(identifiers_to_include)

        # Filter identifiers to include only those defined outside of referenced_files
        filtered_identifiers = set()
        for identifier in identifiers_to_include:
            for ref_file in referenced_files:
                definition = self.codebase.find_definition(identifier, ref_file, only_local=True)
                if definition:
                    break
            else:
                filtered_identifiers.add(identifier)

        # Step 3: Include definitions of referenced identifiers
        definition_map = {}
        for identifier in filtered_identifiers:
            # Pass the referencing file path to find_definition
            definition = self.codebase.find_definition(identifier, filepath)
            print(identifier, definition)
            if definition:
                if definition not in definition_map:
                    definition_map[definition] = set()
                definition_map[definition].add(identifier)

        for definition, identifiers in definition_map.items():
            identifiers_list = ", ".join(identifiers)
            context += f"\nDefinition of {identifiers_list}:\n{definition}\n"

        return context