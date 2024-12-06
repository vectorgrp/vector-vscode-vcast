import argparse
import json
from dcheck.misc.util import paths_to_files
import charset_normalizer
from tqdm import tqdm
from requirement_generation.generation import RequirementsGenerator
from codebase.analysis import Codebase

def save_requirements_to_json(requirements, output_file):
    with open(output_file, 'w') as f:
        json.dump(requirements, f, indent=4)

def save_requirement_references_to_json(requirement_references, output_file):
    with open(output_file, 'w') as f:
        json.dump(requirement_references, f, indent=4)

def main(input_path, requirements_output, references_output):
    codebase = Codebase([input_path])
    functions = codebase.get_all_functions()

    generator = RequirementsGenerator()

    requirements = {}
    requirement_references = []

    for func in tqdm(functions):
        func_name = func['name']
        func_file = func['file']
        func_line = func['line']
        func_code = codebase.get_code_window(func_file, func_line - 1, window=0)
        result = generator.generate(func_code)
        for i, req in enumerate(result):
            req_id = f"{func_name}.{i+1}"
            requirements[req_id] = req
            requirement_references.append({
                "id": req_id,
                "line": func_line,
                "file": func_file
            })

    save_requirements_to_json(requirements, requirements_output)
    save_requirement_references_to_json(requirement_references, references_output)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Decompose design of functions into requirements.")
    parser.add_argument("input_path", help="Path to the directory or file to process.")
    parser.add_argument("requirements_output", help="Path to the output JSON file for requirements.")
    parser.add_argument("references_output", help="Path to the output JSON file for requirement references.")
    args = parser.parse_args()

    main(args.input_path, args.requirements_output, args.references_output)
