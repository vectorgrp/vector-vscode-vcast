class ContextBuilder:
    def __init__(self, codebase, requirement_references):
        self.codebase = codebase
        self.requirement_references = requirement_references

    def build_code_context(self, requirement_id):
        context = ""
        identifiers_to_include = set()

        # Step 1: Include code windows around where the requirement is referenced
        for ref in self.requirement_references:
            if ref.id == requirement_id:
                filepath = ref.file
                line_number = ref.line
                # Use the get_code_window_with_lines method to get code window and line numbers
                code_window, start_line, end_line = self.codebase.get_code_window(filepath, line_number, window=5, return_line_numbers=True)
                context += f"\nCode from {filepath} around line {line_number}:\n{code_window}\n"

                # Extract identifiers from the code window
                identifiers = self.codebase.get_identifiers_in_window(filepath, start_line, end_line)
                identifiers_to_include.update(identifiers)

        """
        # Step 2: Filter identifiers to include only those defined outside of the code windows
        filtered_identifiers = set()
        for identifier in identifiers_to_include:
            definition = self.codebase.find_definition(identifier, filepath, only_local=True)
            if not definition:
                filtered_identifiers.add(identifier)
        """
        filtered_identifiers = identifiers_to_include

        # Step 3: Include definitions of referenced identifiers
        definition_map = {}
        for identifier in filtered_identifiers:
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