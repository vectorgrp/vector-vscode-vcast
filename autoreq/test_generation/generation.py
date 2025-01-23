from enum import Enum
import re
from typing import List
from pydantic import BaseModel
from dotenv import load_dotenv
import logging

from .vcast_context_builder import VcastContextBuilder
from .reduced_vcast_context_builder import VcastReducedContextBuilder
from .atg_context_builder import ATGContextBuilder  # Add this import
from .info_logger import InfoLogger  # Add this import
from ..constants import TEST_FRAMEWORK_REFERENCE_PATH
from ..llm_client import LLMClient  # Import the new LLMClient

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

        @property
        def needed_stub_as_input(self):
            return_match = re.match(r'([^\.]+\.[^\.]+).*\.return', self.identifier, re.IGNORECASE)

            if return_match:
                return return_match.group(1)
            else:
                return None

        @property
        def needed_stub_as_expected(self):
            match = re.match(r'([^\.]+\.[^\.]+)', self.identifier)

            if match:
                return match.group(1)
            else:
                return None

    class TestCase(BaseModel):
        test_name: str
        test_description: str
        requirement_id: str
        unit_name: str
        subprogram_name: str
        input_values: List[ValueMapping]
        expected_values: List[ValueMapping]

        @property
        def unit_names(self):
            return [self.unit_name]

        def to_vectorcast(self, is_compound=False) -> str:
            test_case_str = f"TEST.UNIT:{self.unit_name}\n"
            test_case_str += f"TEST.SUBPROGRAM:{self.subprogram_name}\n"
            test_case_str += "TEST.NEW\n"
            test_case_str += f"TEST.NAME:{('compound' if is_compound else '') + self.test_name}\n"

            test_case_str += f"TEST.REQUIREMENT_KEY:{self.requirement_id}\n"

            test_case_str += "TEST.NOTES:\n"
            for line in self.test_description.split('\n'):
                test_case_str += f"{line}\n"
            test_case_str += "TEST.END_NOTES:\n"

            for stub in self._get_needed_stubs():
                test_case_str += f"TEST.STUB:{stub}\n"

            # Sometimes the LLM duplicates assignments. Deduplicating them is a free win
            seen_inputs = set()
            for input_value in self.input_values:
                vectorcast_input = input_value.to_vectorcast()

                if vectorcast_input in seen_inputs:
                    continue

                test_case_str += vectorcast_input
                seen_inputs.add(vectorcast_input)

            seen_expected = set()
            for expected_value in self.expected_values:
                vectorcast_expected = expected_value.to_vectorcast(is_expected=True)

                if vectorcast_expected in seen_expected:
                    continue

                test_case_str += vectorcast_expected
                seen_expected.add(vectorcast_expected)

            test_case_str += "TEST.END\n"
            return test_case_str

        def _get_needed_stubs(self):
            needed_stubs = set()
            for input_value in self.input_values:
                stub = input_value.needed_stub_as_input

                if not stub:
                    continue

                unit_name, subprogram_name = stub.split('.', 1)

                if self.subprogram_name.startswith(subprogram_name):
                    continue

                if subprogram_name == '<<GLOBAL>>':
                    continue
                
                needed_stubs.add(stub)

            for expected_value in self.expected_values:
                stub = expected_value.needed_stub_as_expected

                if not stub:
                    continue

                unit_name, subprogram_name = stub.split('.', 1)

                if self.subprogram_name.startswith(subprogram_name):
                    continue

                if subprogram_name == '<<GLOBAL>>':
                    continue
                
                needed_stubs.add(stub)

            return needed_stubs
    
    class TestGenerationResult(BaseModel):
        test_description: str
        test_mapping_analysis: str
        test_case: TestCase

        @property
        def test_cases(self):
            return [self.test_case]

    return TestGenerationResult

class TestGenerator:
    def __init__(self, requirements, environment, use_extended_reasoning=False):
        self.requirements = requirements
        self.environment = environment  # Use the provided environment
        self.context_builder = VcastReducedContextBuilder(self.environment)
        self.atg_context_builder = ATGContextBuilder(self.environment)  # Add this line
        self.llm_client = LLMClient()
        self.info_logger = InfoLogger()
        self.use_extended_reasoning = use_extended_reasoning

    async def generate_test_case(self, requirement_id, max_retries=1):
        self.info_logger.start_requirement(requirement_id)
        first_try = True
        for _ in range(max_retries):
            self.info_logger.increment_retries_used(requirement_id)
            temperature = 0.0 if first_try else 1.0
            extended_reasoning = self.use_extended_reasoning and not first_try  # Modify this line
            allow_partial = True
            result = await self._generate_test_case_no_retries(requirement_id, temperature=temperature, extended_reasoning=extended_reasoning, allow_partial=allow_partial)
            if result:
                self.info_logger.set_test_generated(requirement_id)
                return result
            else:
                first_try = False

        return None

    async def _generate_test_case_no_retries(self, requirement_id, temperature=0, extended_reasoning=False, allow_partial=False):
        requirement_text = self.requirements.get(requirement_id)
        if not requirement_text:
            logging.warning(f"Requirement {requirement_id} not found.")
            return None

        # Build code context using the environment
        function_name = requirement_id.rsplit('.', 1)[0]
        context = await self.context_builder.build_code_context(function_name)
        logging.debug("Generated code context: %s", context)
        
        # Determine number of example test cases based on context length
        context_lines = len(context.strip().split('\n'))
        if context_lines < 200:
            num_examples = 1
            basis_path = False
        else:
            num_examples = 3
            basis_path = True

        atg_examples = ""
        logging.info(f"Fetching {num_examples} ATG example test cases")
        atg_examples = await self.atg_context_builder.get_relevant_test_cases(function_name, k=num_examples, basis_path=basis_path)
        logging.debug("Retrieved ATG examples: %s", atg_examples)

        with open(TEST_FRAMEWORK_REFERENCE_PATH, "r") as f:
            test_framework_reference = f.read()

        example_test_cases_section = ""
        if num_examples > 0:
            example_test_cases_section = f"""
Example Test Cases:
```json
{atg_examples}
```
"""

        messages = [
            {
                "role": "system",
                "content": "You are an AI assistant that generates test code for given requirements."
            },
            {
                "role": "user",
                "content": f"""
Based on the following requirement, references, code and example test cases, generate unit tests that exercise the requirement.

Test framework reference:
{test_framework_reference}

Relevant Code:
```cpp
{context}
```
{example_test_cases_section}
Requirement ID: {requirement_id}
Requirement Text: {requirement_text}

Detailed task description:
Based on the above requirement and code, generate a unit test that exercises the requirement.
Make sure the generated test case clearly test the provided requirement.

Solve the problem using the following steps:
1. Give a description in natural language of how the requirement should be tested.
2. Think about which values need to be set to what and what we expect to happen in the actual code, i.e., how do we translate from natural language descripion to implementation?
3. Generate a test case in the syntax provided above.
    a. Come up with a descriptive (unique) name for the test case and describe in natural language how this test exercises the requirement
    b. Provide the name of the unit being tested (base file name without extension) and the name of the subprogram being tested (function name)
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

        schema = _derive_schema(self.environment.allowed_identifiers)

        try:
            test_generation_result = await self.llm_client.call_model(messages, schema, temperature=temperature, extended_reasoning=extended_reasoning)
            # Removed for_requirement parameter
        except Exception as e:
            logging.exception("Failed to generate test case.")
            return None

        test_generation_result = await self._iterative_error_correction(
            requirement_id, test_generation_result, messages, schema, temperature=temperature, extended_reasoning=extended_reasoning, allow_partial=allow_partial)

        if test_generation_result is None:
            return None

        return test_generation_result

    def _create_partial_test_case(self, test_generation_result):
        """Creates a partial test case by removing expected values."""
        # Create a copy of the test generation result
        partial_result = test_generation_result.model_copy(deep=True)
        
        # Remove expected values from each test case
        for test_case in partial_result.test_cases:
            test_case.expected_values = []
            test_case.test_name = test_case.test_name + "-PARTIAL"
        
        return partial_result

    async def _iterative_error_correction(self, requirement_id, test_generation_result, messages, schema, temperature=0.0, extended_reasoning=False, max_iterations=3, allow_partial=False):
        iteration = 0
        fix_messages = messages
        while iteration < max_iterations:
            iteration += 1
            # Generate vectorcast test cases for all test cases
            vectorcast_cases = [tc.to_vectorcast() for tc in test_generation_result.test_cases]

            output = self.environment.run_tests(vectorcast_cases, execute=True)
            errors, test_failures = self._parse_error_output(output)

            if not errors and not test_failures:
                break

            # Set test_run_failure_feedback only if test failures are detected
            if test_failures:
                self.info_logger.set_test_run_failure_feedback(requirement_id)

            if errors or test_failures:
                self.info_logger.set_error_correction_needed(requirement_id)
                # Prepare new messages with errors for the model
                logging.info("Errors detected in test case. Iteration %d", iteration)
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

                with open(f"fix_messages_{requirement_id}.txt", "w") as f:
                    for message in fix_messages:
                        f.write(f"{message['role']}: {message['content']}\n\n")
                
                # Call the model to get the fixed test case
                test_generation_result = await self.llm_client.call_model(fix_messages, schema, temperature=temperature, extended_reasoning=extended_reasoning)

        if errors:
            logging.warning(f"Failed to fix errors after {iteration} iterations")
            return None
        elif test_failures:
            logging.info("Converting to partial test case due to persistent test failures")
            
            if allow_partial:
                return self._create_partial_test_case(test_generation_result)

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

        logging.debug("Output:\n%s", output)
        logging.debug("Errors:\n%s", '\n'.join(error_lines))
        logging.debug("Test Failures:\n%s", '\n'.join(test_fail_lines))

        return '\n'.join(error_lines) if error_lines else None, '\n'.join(test_fail_lines) if test_fail_lines else None