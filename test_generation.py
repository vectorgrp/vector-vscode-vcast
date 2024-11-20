import json
import openai
import os
import re
from typing import List
from pydantic import BaseModel
from dotenv import load_dotenv
from context_builder import ContextBuilder
from code_analysis import Codebase

# Load environment variables from .env file
load_dotenv()

class ValueMapping(BaseModel):
    identifier: str
    value: str

    def to_vectorcast(self, is_expected=False) -> str:
        patched_identifier = re.sub(r'(\w+)->', r'*\1.', self.identifier)
        if is_expected:
            return f"TEST.EXPECTED:{patched_identifier}:{self.value}\n"
        return f"TEST.VALUE:{patched_identifier}:{self.value}\n"

class ReferenceMapping(BaseModel):
    identifier: str
    reference: str

    def to_vectorcast(self, is_expected=False) -> str:
        patched_identifier = re.sub(r'(\w+)->', r'*\1.', self.identifier)
        patched_reference = re.sub(r'(\w+)->', r'*\1.', self.reference)
        if is_expected:
            return (
                f"TEST.EXPECTED_USER_CODE:{patched_identifier}\n"
                f"<<{patched_identifier}>> == ( <<{patched_reference}>> )\n"
                "TEST.END_EXPECTED_USER_CODE:\n"
            )
        return (
            f"TEST.VALUE_USER_CODE:{patched_identifier}\n"
            f"<<{patched_identifier}>> = ( <<{patched_reference}>> );\n"
            "TEST.END_VALUE_USER_CODE:\n"
        )

class TestCase(BaseModel):
    regular_test_name: str
    regular_test_description: str
    unit_name: str
    subprogram_name: str
    input_values: List[ValueMapping]
    input_references: List[ReferenceMapping]
    expected_values: List[ValueMapping]
    expected_references: List[ReferenceMapping]

    @property
    def unit_names(self):
        return [self.unit_name]

    def to_vectorcast(self, tested_requirements=[]) -> str:
        test_case_str = f"TEST.UNIT:{self.unit_name}\n"
        test_case_str += f"TEST.SUBPROGRAM:{self.subprogram_name}\n"
        test_case_str += "TEST.NEW\n"
        test_case_str += f"TEST.NAME:{self.regular_test_name}\n"

        for req in tested_requirements:
            test_case_str += f"TEST.REQUIREMENT_KEY:{req}\n"

        test_case_str += "TEST.NOTES:\n"
        for line in self.regular_test_description.split('\n'):
            test_case_str += f"{line}\n"
        test_case_str += "TEST.END_NOTES:\n"

        for input_value in self.input_values:
            test_case_str += input_value.to_vectorcast()

        for input_reference in self.input_references:
            test_case_str += input_reference.to_vectorcast()

        for expected_value in self.expected_values:
            test_case_str += expected_value.to_vectorcast(is_expected=True)
            
        for expected_reference in self.expected_references:
            test_case_str += expected_reference.to_vectorcast(is_expected=True)

        test_case_str += "TEST.END\n"
        return test_case_str

class CompoundTestCase(BaseModel):
    compound_test_name: str
    compound_test_description: str
    sub_test_cases: List[TestCase]

    @property
    def unit_names(self):
        return [sub_test_case.unit_name for sub_test_case in self.sub_test_cases]

    def to_vectorcast(self, tested_requirements=[]) -> str:
        test_case_str = ""

        for test_case in self.sub_test_cases:
            test_case_str += test_case.to_vectorcast(tested_requirements)

        test_case_str += "TEST.SUBPROGRAM:<<COMPOUND>>\n"
        test_case_str += "TEST.NEW\n"
        test_case_str += f"TEST.NAME:{self.compound_test_name}\n"

        for req in tested_requirements:
            test_case_str += f"TEST.REQUIREMENT_KEY:{req}\n"

        test_case_str += "TEST.NOTES:\n"
        for line in self.compound_test_description.split('\n'):
            test_case_str += f"{line}\n"
        test_case_str += "TEST.END_NOTES:\n"

        for idx, test_case in enumerate(self.sub_test_cases, 1):
            test_case_str += f'TEST.SLOT: "{idx}", "{test_case.unit_name}", "{test_case.subprogram_name}", "1", "{test_case.regular_test_name}"\n'
        test_case_str += "TEST.END\n"

        return test_case_str

class TestGenerationResult(BaseModel):
    test_description: str
    test_quantity_and_quality_analysis: str
    test_mapping_analysis: str
    regular_test_cases: List[TestCase]
    compound_test_cases: List[CompoundTestCase]

    @property
    def test_cases(self):
        return self.regular_test_cases + self.compound_test_cases

class TestGenerator:
    def __init__(self, requirements, requirement_references, source_dirs):
        self.requirements = requirements
        self.requirement_references = requirement_references
        self.codebase = Codebase(source_dirs)
        self.context_builder = ContextBuilder(self.codebase, requirement_references)
        self.client = openai.AzureOpenAI(
            api_key=os.getenv("OPENAI_API_KEY"),  
            api_version="2024-08-01-preview",
            azure_endpoint=os.getenv("OPENAI_API_BASE"),
            azure_deployment=os.getenv("OPENAI_GENERATION_DEPLOYMENT")
        )

    def generate_test_case(self, requirement_id, num_context_tests=3, related_tests=True, return_raw_completion=False):
        requirement_text = self.requirements.get(requirement_id)
        if not requirement_text:
            print(f"Requirement {requirement_id} not found.")
            return

        context = self.context_builder.build_code_context(requirement_id)

        with open("identifier_syntax_reference.md", "r") as f:
            identifier_syntax_reference = f.read()

        messages = [
            {
                "role": "system",
                "content": "You are an AI assistant that generates test code for given requirements."
            },
            {
                "role": "user",
                "content": f"""
Based on the following requirement, references and code, generate a test case that exercises the requirement.

Input and expected value syntax reference:
{identifier_syntax_reference}

Relevant Code:
{context}

Requirement ID: {requirement_id}
Requirement Text: {requirement_text}

Detailed task description:
Based on the above requirement and code, generate a test case that exercise the requirement.
Make sure the generated test case clearly test the provided requirement.

Solve the problem using the following steps:
1. Give a description in natural language of how the requirement should be tested.
2. Consider explicitly how many test cases are necessary and whether some of the require multiple subprograms to be tested in sequence.
3. Think about which values need to be set and what we expect to happen in the actual code, i.e., how do we translate from natural language descripion to implementation?
4. Generate regular test cases (zero or more depending on what you deem to be suitable) to test individual subprograms.
    a. Provide the name of the unit being tested (base file name without extension) and the name of the subprogram being tested (function name)
    b. Come up with a descriptive (unique) name for the test case and describe in natural language how this test exercises the requirement
    c. Provide the input and expected values by providing the correct identifier and value in the syntax outlined above.
       Note: Add things to input/expected_values that represent direct values, and add things to input/expected_references that represent references to other values (use the same syntax for the reference as you would for identifiers in general).
5. Generate compound test cases (if necessary) to test multiple subprograms in sequence (or the same one multiple times).
    a. Provide a descriptive name for the compound test case
    b. List the sub test cases that need to be executed in sequence (each with unique names of their own)

Notes:
- You are NOT allowed to invent any syntax that is not specified in the syntax reference. Stick to the syntax provided.
- You are NOT allowed to invent any units or functions that are not present in the provided code.
- This is a highly critical task, please ensure that the test case is correct and complete and does not contain any logical or syntactical errors.
- Test cases are independent of each other, i.e., they should not rely on one being run before the other (or environment being modified by one). To test different subprograms one after the other use a compound test case (and potentially pass information between the test cases using references).
- Do not duplicate tests by adding them both to regular_test_cases and as part of a compound test
"""
            }
        ]

        with open("input_messages.txt", "w") as f:
            for message in messages:
                f.write(f"{message['role']}: {message['content']}\n\n")

        completion = self.client.beta.chat.completions.parse(
            model="gpt-4o",
            messages=messages,
            response_format=TestGenerationResult,
            temperature=0.0,
            seed=42,
            max_tokens=2000,
        )

        try:
            generated_test_case = completion.choices[0].message.parsed
            if return_raw_completion:
                return generated_test_case, completion
            return generated_test_case
        except Exception as e:
            print("Failed to parse generated test case.")
            print("Error:", e)
            print("Assistant's response:")
            print(completion.choices[0].message)
            return None
