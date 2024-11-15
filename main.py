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
    result, completion = test_generator.generate_test_case(requirement_id, 0, False, return_raw_completion=True)
    if result:
        print("Test Description:")
        print(result.test_description)
        print("Test quantity and quality analysis:")
        print(result.test_quantity_and_quality_analysis)
        print("Test Mapping Analysis:")
        print(result.test_mapping_analysis)
        for test_case in result.test_cases:
            print("VectorCAST Test Case:")
            print(test_case.to_vectorcast([requirement_id]))

        # Calculate and save cost information
        input_tokens = completion.usage.prompt_tokens
        output_tokens = completion.usage.completion_tokens
        total_tokens = input_tokens + output_tokens

        input_cost = (input_tokens / 1000) * 0.00275
        output_cost = (output_tokens / 1000) * 0.011
        total_cost = input_cost + output_cost

        with open('cost.txt', 'w') as cost_file:
            cost_file.write(f"Input Tokens: {input_tokens}\n")
            cost_file.write(f"Output Tokens: {output_tokens}\n")
            cost_file.write(f"Total Tokens: {total_tokens}\n")
            cost_file.write(f"Input Cost: €{input_cost:.6f}\n")
            cost_file.write(f"Output Cost: €{output_cost:.6f}\n")
            cost_file.write(f"Total Cost: €{total_cost:.6f}\n")
