import os

class RequirementLocator:
    def __init__(self, requirement_references):
        self.requirement_references = requirement_references

    def get_unit_names_and_paths(self, requirement_id):
        unit_names = set()
        unit_paths = set()

        for ref in self.requirement_references:
            if ref.id == requirement_id:
                unit_name = os.path.splitext(os.path.basename(ref.file))[0]
                unit_path = os.path.abspath(ref.file)
                unit_names.add(unit_name)
                unit_paths.add(unit_path)

        return list(unit_names), list(unit_paths)

    def get_line_numbers(self, requirement_id, file_path):
        line_numbers = set()
        for ref in self.requirement_references:
            if ref.id == requirement_id and os.path.abspath(ref.file) == file_path:
                line_numbers.add(ref.line)
        return list(line_numbers)