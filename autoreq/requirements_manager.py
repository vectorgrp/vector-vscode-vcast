import csv
import os

class RequirementsManager:
    def __init__(self, requirements_or_path):
        # If it's a path (str), load from CSV; if it's already a list, store directly
        if isinstance(requirements_or_path, str) and os.path.isfile(requirements_or_path):
            self._requirements = self._load_from_csv(requirements_or_path)
        else:
            self._requirements = requirements_or_path  # Expecting a list of dicts

        # Build a quick lookup by requirement ID
        self._requirements_by_id = {}
        for req in self._requirements:
            self._requirements_by_id[req['ID']] = req

    def _load_from_csv(self, path):
        reqs = []
        with open(path, newline='') as csvfile:
            reader = csv.DictReader(csvfile)
            for row in reader:
                reqs.append(row)
        return reqs

    @property
    def requirement_ids(self):
        return list(self._requirements_by_id.keys())

    def get_function(self, requirement_id):
        req = self._requirements_by_id.get(requirement_id)
        return req['Function'] if req else None

    def get_description(self, requirement_id):
        req = self._requirements_by_id.get(requirement_id)
        return req['Description'] if req else None

    def group_by_function(self, requirement_ids=None):
        if not requirement_ids:
            requirement_ids = self.requirement_ids

        grouped = {}
        for rid in requirement_ids:
            func = self.get_function(rid)
            if func not in grouped:
                grouped[func] = []
            grouped[func].append(rid)
        return grouped

    def get_requirements_for_function(self, function_name):
        return self.group_by_function().get(function_name, [])

    def requirements_to_dict(self):
        """Return a dictionary representation of all requirements."""
        return self._requirements

    def get_requirement(self, requirement_id):
        """Get a specific requirement by ID."""
        return self._requirements_by_id.get(requirement_id)