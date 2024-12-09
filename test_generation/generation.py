from enum import Enum
import json
import instructor
import openai
import os
import re
from typing import List
from pydantic import BaseModel, create_model, Field
from dotenv import load_dotenv
from test_generation.ast_context_builder import ASTContextBuilder
from codebase.analysis import Codebase
from test_generation.vcast_context_builder import VcastContextBuilder
from test_generation.requirement_locator import RequirementLocator
import asyncio
from test_generation.info_logger import InfoLogger  # Add this import
from llm_client import LLMClient  # Import the new LLMClient

# Load environment variables from .env file
load_dotenv()

def _derive_schema(allowed_identifiers=None):
    class TempEnum(str, Enum):
        pass

    # If we have knowledge of allowed identifiers, constrain the type of Identifier to those values
    if allowed_identifiers:
        Identifier = TempEnum("Identifier", [(ident, ident) for ident in allowed_identifiers])
    else:
        Identifier = str
    
    class ValueMapping(BaseModel):
        identifier: Identifier # type: ignore
        value: str

        def to_vectorcast(self, is_expected=False) -> str:
            patched_identifier = re.sub(r'(\w+)->', r'*\1.', self.identifier)
            patched_identifier = re.sub(r'\*(\w+)\.', r'*\1[0].', patched_identifier)
            if is_expected:
                return f"TEST.EXPECTED:{patched_identifier}:{self.value}\n"
            return f"TEST.VALUE:{patched_identifier}:{self.value}\n"

    class ReferenceMapping(BaseModel):
        identifier: Identifier # type: ignore
        reference: Identifier # type: ignore

        def to_vectorcast(self, is_expected=False) -> str:
            patched_identifier = re.sub(r'(\w+)->', r'*\1[0].', self.identifier)
            patched_identifier = re.sub(r'\*(\w+)\.', r'*\1[0].', patched_identifier)
            patched_reference = re.sub(r'(\w+)->', r'*\1[0].', self.reference)
            patched_reference = re.sub(r'\*(\w+)\.', r'*\1[0].', patched_reference)
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
        test_name: str
        test_description: str
        unit_name: str
        subprogram_name: str
        input_values: List[ValueMapping]
        expected_values: List[ValueMapping]

        @property
        def unit_names(self):
            return [self.unit_name]

        def to_vectorcast(self, tested_requirements=[], is_compound=False) -> str:
            test_case_str = f"TEST.UNIT:{self.unit_name}\n"
            test_case_str += f"TEST.SUBPROGRAM:{self.subprogram_name}\n"
            test_case_str += "TEST.NEW\n"
            test_case_str += f"TEST.NAME:{('compound' if is_compound else '') + self.test_name}\n"

            for req in tested_requirements:
                test_case_str += f"TEST.REQUIREMENT_KEY:{req}\n"

            test_case_str += "TEST.NOTES:\n"
            for line in self.test_description.split('\n'):
                test_case_str += f"{line}\n"
            test_case_str += "TEST.END_NOTES:\n"

            for input_value in self.input_values:
                test_case_str += input_value.to_vectorcast()

            for expected_value in self.expected_values:
                test_case_str += expected_value.to_vectorcast(is_expected=True)
                
            test_case_str += "TEST.END\n"
            return test_case_str

    class TestGenerationResult(BaseModel):
        test_description: str
        test_mapping_analysis: str
        test_case: TestCase

        @property
        def test_cases(self):
            return [self.test_case]

    return TestGenerationResult

class TestGenerator:
    def __init__(self, requirements, requirement_references, environment_manager, use_extended_reasoning=False):
        self.requirements = requirements
        self.requirement_locator = RequirementLocator(requirement_references)
        self.environment_manager = environment_manager
        self.context_builder = VcastContextBuilder(self.environment_manager, self.requirement_locator)
        self.llm_client = LLMClient()  # Use LLMClient instead of OpenAI clients
        self.info_logger = InfoLogger()  # InfoLogger without token counting
        self.use_extended_reasoning = use_extended_reasoning  # Add this line

    async def generate_test_case(self, requirement_id, max_retries=1):
        self.info_logger.start_requirement(requirement_id)
        first_try = True
        for _ in range(max_retries):
            self.info_logger.increment_retries_used(requirement_id)
            temperature = 0.0 if first_try else 1.0
            extended_reasoning = self.use_extended_reasoning and not first_try  # Modify this line
            result = await self._generate_test_case_no_retries(requirement_id, temperature=temperature, extended_reasoning=extended_reasoning)
            if result:
                self.info_logger.set_test_generated(requirement_id)
                return result
            else:
                first_try = False

        return None

    async def _generate_test_case_no_retries(self, requirement_id, temperature=0, extended_reasoning=False):
        requirement_text = self.requirements.get(requirement_id)
        if not requirement_text:
            print(f"Requirement {requirement_id} not found.")
            return None

        context = await self.context_builder.build_code_context(requirement_id, reduce_context=True)

        environment = self.environment_manager.get_environment_for_requirement(
            requirement_id, self.requirement_locator
        )

        if not environment:
            print("No suitable environment found for the requirement.")
            return None

        with open("test_framework_reference.md", "r") as f:
            test_framework_reference = f.read()

        messages = [
            {
                "role": "system",
                "content": "You are an AI assistant that generates test code for given requirements."
            },
            {
                "role": "user",
                "content": f"""
Based on the following requirement, references and code, generate unit tests that exercise the requirement.

Test framework reference:
{test_framework_reference}

Relevant Code:
```cpp
{context}
```

Requirement ID: {requirement_id}
Requirement Text: {requirement_text}

Detailed task description:
Based on the above requirement and code, generate a unit test that exercises the requirement.
Make sure the generated test case clearly test the provided requirement.

Solve the problem using the following steps:
1. Give a description in natural language of how the requirement should be tested.
3. Think about which values need to be set to what and what we expect to happen in the actual code, i.e., how do we translate from natural language descripion to implementation?
4. Generate a test case (one or more depending on what you deem to be suitable) to test individual subprograms.
    a. Provide the name of the unit being tested (base file name without extension) and the name of the subprogram being tested (function name)
    b. Come up with a descriptive (unique) name for the test case and describe in natural language how this test exercises the requirement
    c. Provide the input and expected values by providing the correct identifier and value in the syntax outlined above.

Notes:
- You are NOT allowed to invent any syntax that is not specified in the syntax reference. Stick to the syntax provided.
- You are NOT allowed to invent any units or functions that are not present in the provided code.
- This is a highly critical task, please ensure that the test case is correct and complete and does not contain any logical or syntactical errors.
- Test cases are independent of each other, i.e., they should not rely on one being run before the other (or environment being modified by one).
"""
            }
        ]

        with open("input_messages.txt", "w") as f:
            for message in messages:
                f.write(f"{message['role']}: {message['content']}\n\n")

        schema = _derive_schema(environment.allowed_identifiers)

        try:
            completion = await self.llm_client.call_model(messages, schema, temperature=temperature, extended_reasoning=extended_reasoning)
            # Removed for_requirement parameter
        except Exception as e:
            import traceback
            traceback.print_exc()
            print("Failed to generate test case.")
            return None


        try:
            test_generation_result = completion.choices[0].message.parsed
            test_generation_result = await self._iterative_error_correction(
                requirement_id, test_generation_result, messages, schema, temperature=temperature, extended_reasoning=extended_reasoning)

            if test_generation_result is None:
                return None

            return test_generation_result
        except Exception as e:
            print("Failed to parse generated test case.")
            print("Error:", e)
            print("Assistant's response:")
            print(completion.choices[0].message)
            return None

    async def _iterative_error_correction(self, requirement_id, test_generation_result, messages, schema, temperature=0.0, extended_reasoning=False, max_iterations=3):
        iteration = 0
        fix_messages = messages
        self.info_logger.set_error_correction_needed(requirement_id)
        while iteration < max_iterations:
            iteration += 1
            # Generate vectorcast test cases for all test cases
            vectorcast_cases = [tc.to_vectorcast([requirement_id]) for tc in test_generation_result.test_cases]
            # Execute tests and collect output
            all_units = set(unit_name for test_case in test_generation_result.test_cases for unit_name in test_case.unit_names)
            environment = self.environment_manager.get_environment(all_units)
            if not environment:
                print("No suitable environment found for execution.")
                break

            output = environment.run_tests(vectorcast_cases, execute=True)
            errors, test_failures = self._parse_error_output(output)

            if not errors and not test_failures:
                break

            # Set test_run_failure_feedback only if test failures are detected
            if test_failures:
                self.info_logger.set_test_run_failure_feedback(requirement_id)

            if errors or test_failures:
                # Prepare new messages with errors for the model
                fix_messages += [
                    {
                        "role": "assistant",
                        "content": test_generation_result.model_dump_json(indent=4)
                    },
                    {
                        "role": "user",
                        "content": f"""
There were errors when executing the test case:

Error Output:
```
{errors or test_failures}
```

Please fix the test case accordingly, ensuring that the identifiers match exactly the syntax described in the reference.

Remember:
- Do not change the units or functions being tested.
- Use the syntax reference provided.
- Ensure that the test case is correct and complete and does not contain any logical or syntactical errors.

Tip:
- If you see something like this in the errors: error: expected expression before '<<' token, then that likely means you are setting a macro in a reference which is not allowed.
- If you see something like this in the errors: [  FAIL  ], then that means the test case failed to pass. Likely because you misunderstood the requirement, the code or the testing framework.
"""
                    }
                ]

            with open("fix_messages.txt", "w") as f:
                for message in fix_messages:
                    f.write(f"{message['role']}: {message['content']}\n\n")
            
            # Call the model to get the fixed test case
            completion = await self.llm_client.call_model(fix_messages, schema, temperature=temperature, extended_reasoning=extended_reasoning)
            # Removed for_requirement parameter

            try:
                test_generation_result = completion.choices[0].message.parsed
            except Exception as e:
                print(completion.choices[0].message)
                print("Failed to parse fixed test case.")
                print("Error:", e)
                break
        if errors or test_failures:
            print(f"Failed to fix errors and test failures after {iteration} iterations")
            return None

        return test_generation_result

    def _parse_error_output(self, output):
        error_lines = []
        test_fail_lines = []

        # Extract error messages starting with (E) and include indented lines
        lines = output.split('\n')
        collecting_error = False
        for line in lines:
            if re.match(r'\(E\)', line):
                if "TEST.REQUIREMENT_KEY" in line:
                    continue  # Skip requirement key errors
                error_lines.append(line)
                collecting_error = True
                continue
            if collecting_error:
                if line.startswith('    ') or line.strip() == '':
                    error_lines.append(line)
                else:
                    collecting_error = False

        # Check for compile errors
        compile_error_index = output.find("Compile Failed")
        # Include all lines after "Compile Failed"
        if compile_error_index != -1:
            compile_error_output = output[compile_error_index:]

            if compile_error_output.strip():
                error_lines.append(compile_error_output.strip())
        else:
            # Extract feedback from test execution
            # We likely do not want to include this
            for line in lines:
                if '========' in line:
                    break
                elif re.search(r'\[\s+FAIL\s+\]', line):
                    test_fail_lines.append(line.strip())
                elif re.search(r'\[\s+\]', line):
                    test_fail_lines.append(line.strip())

        print("Output:")
        print(output)

        print("Errors:")
        print('\n'.join(error_lines))
        print("Test Failures:")
        print('\n'.join(test_fail_lines))

        return '\n'.join(error_lines) if error_lines else None, '\n'.join(test_fail_lines) if test_fail_lines else None