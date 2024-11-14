import json
from test_generation import TestGenerator
from code_extraction import extract_all_requirement_references

with open('extracted_reqs.json') as f:
    requirements = json.load(f)

requirement_references = extract_all_requirement_references('pi--innovo')
source_dirs = ['pi--innovo']  # Modify as needed to include relevant source directories

if __name__ == '__main__':
    requirement_id = input('Enter requirement ID (default: LLR.PLAT.REG.AVAIL.003): ') or 'LLR.PLAT.REG.AVAIL.003'
    test_generator = TestGenerator(requirements, requirement_references, source_dirs)
    result = test_generator.generate_test_case(requirement_id, 0, False)
    if result:
        print("Test Description:")
        print(result.test_description)
        print("Test Mapping Analysis:")
        print(result.test_mapping_analysis)
        for test_case in result.test_cases:
            print("VectorCAST Test Case:")
            print(test_case.to_vectorcast())
