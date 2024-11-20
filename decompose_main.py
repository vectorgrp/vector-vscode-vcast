import argparse
import json
from dcheck.processing.code_extraction import extract_function_defs
from dcheck.misc.util import paths_to_files
import charset_normalizer
from tqdm import tqdm
from design_decomposition.decompose import DesignDecomposer

def save_requirements_to_json(requirements, output_file):
    with open(output_file, 'w') as f:
        json.dump(requirements, f, indent=4)

def save_requirement_references_to_json(requirement_references, output_file):
    with open(output_file, 'w') as f:
        json.dump(requirement_references, f, indent=4)

def main(input_path, requirements_output, references_output):
    source_files = paths_to_files([input_path])

    func_defs = []
    for source_file in tqdm(source_files):
        try:
            source_code = str(charset_normalizer.from_path(source_file).best())
            func_defs += extract_function_defs(source_code, remembered_filepath=source_file)
        except Exception as e:
            print(f'Error processing {source_file}: {e}')

    decomposer = DesignDecomposer()

    requirements = {}
    requirement_references = []

    for func_def in tqdm(func_defs):
        result = decomposer.decompose_design(func_def)
        func_name = func_def.name
        for i, req in enumerate(result.requirements):
            req_id = f"{func_name}.{i+1}"
            requirements[req_id] = req.requirement_text
            requirement_references.append({
                "id": req_id,
                "line": func_def.source.start_line,
                "file": func_def.source.path
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
