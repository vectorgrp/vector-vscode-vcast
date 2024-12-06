from test_generation.requirement_locator import RequirementLocator

class ASTContextBuilder:
    def __init__(self, codebase, requirement_locator):
        self.codebase = codebase
        self.requirement_locator = requirement_locator

    def build_code_context(self, requirement_id):
        context = ""
        identifiers_to_include = set()

        unit_names, unit_paths = self.requirement_locator.get_unit_names_and_paths(requirement_id)

        # Temporary assumption
        assert len(unit_paths) == 1

        unit_path = unit_paths[0]

        # Step 1: Include code windows around where the requirement is referenced
        line_numbers = self.requirement_locator.get_line_numbers(requirement_id, unit_path)
        for line_number in line_numbers:
            # Use the get_code_window_with_lines method to get code window and line numbers
            code_window, start_line, end_line = self.codebase.get_code_window(
                unit_path, line_number, window=5, return_line_numbers=True)
            context += f"\nCode from {unit_path} around line {line_number}:\n{code_window}\n"

            # Extract identifiers from the code window
            identifiers = self.codebase.get_identifiers_in_window(unit_path, start_line, end_line)
            identifiers_to_include.update(identifiers)

        filtered_identifiers = identifiers_to_include

        # Step 2: Include definitions of referenced identifiers
        definition_map = {}
        for identifier in filtered_identifiers:
            definition = self.codebase.find_definition(identifier, unit_path)
            print(identifier, definition)
            if definition:
                if definition not in definition_map:
                    definition_map[definition] = set()
                definition_map[definition].add(identifier)

        for definition, identifiers in definition_map.items():
            identifiers_list = ", ".join(identifiers)
            context += f"\nDefinition of {identifiers_list}:\n{definition}\n"

        return context