import typing as t
import os
from pathlib import Path

import csv
from openpyxl import load_workbook


class RequirementsManager:
    def __init__(self, requirements_or_path: t.Union[t.List[t.Dict], str]):
        # If it's a path (str), load from CSV or Excel; if it's already a list, store directly
        if isinstance(requirements_or_path, str) and os.path.isfile(requirements_or_path):
            self._requirements = self._load_from_file(requirements_or_path)
        else:
            self._requirements = requirements_or_path  # Expecting a list of dicts

        # Build a quick lookup by requirement ID
        self._requirements_by_id = {}
        for req in self._requirements:
            self._requirements_by_id[req['ID']] = req

    def _load_from_csv(self, path: t.Union[str, Path]):
        reqs = []
        with open(path, newline='') as csvfile:
            reader = csv.DictReader(csvfile)
            for row in reader:
                reqs.append(row)
        return reqs

    def _load_from_excel(self, file_path: t.Union[str, Path]):
        workbook = load_workbook(file_path, data_only=True)
        sheet = workbook.active
        headers = [cell.value for cell in sheet[1]]
        reqs = []
        for row in sheet.iter_rows(min_row=2, values_only=True):
            reqs.append(dict(zip(headers, row)))

        return reqs

    def _load_from_file(self, path: str):
        path = Path(path)
        if path.suffix == '.csv':
            return self._load_from_csv(path)
        elif path.suffix == '.xlsx':
            return self._load_from_excel(path)
        else:
            raise ValueError(f"Unsupported file format: {path.suffix}")

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

    def filter(self, filter_callback) -> 'RequirementsManager':
        """Filter requirements based on a callback function."""
        return RequirementsManager([self._requirements_by_id[req_id] for req_id in filter(filter_callback, self.requirement_ids)])