import asyncio
from aiostream.stream import merge
from enum import Enum
import json
import re
from typing import List
from pydantic import BaseModel, create_model
from dotenv import load_dotenv
import logging

from .vcast_context_builder import VcastContextBuilder
from .atg_context_builder import ATGContextBuilder  # Add this import
from .info_logger import InfoLogger  # Add this import
from ..constants import TEST_FRAMEWORK_REFERENCE_PATH
from ..llm_client import LLMClient  # Import the new LLMClient

# Load environment variables from .env file
load_dotenv()

def _derive_test_case_schema(allowed_identifiers=None):
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

        @property
        def as_partial(self):
            return TestCase(
                test_name=self.test_name + '-PARTIAL',
                test_description=self.test_description,
                requirement_id=self.requirement_id,
                unit_name=self.unit_name,
                subprogram_name=self.subprogram_name,
                input_values=self.input_values,
                expected_values=[]
            )

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

    return TestCase

def _derive_completion_schema(batched, allowed_identifiers=None, batch_size=None):
    TestCase = _derive_test_case_schema(allowed_identifiers=allowed_identifiers)
    
    if not batched:
        class TestGenerationResult(BaseModel):
            test_description: str
            test_mapping_analysis: str
            test_case: TestCase # type: ignore

            @property
            def test_cases(self):
                return [self.test_case]

        schema = TestGenerationResult
    else:
        assert batch_size is not None, "Batch size must be provided when generating a batched schema."
        result_keys = {f"test_case_for_requirement_{i+1}": (TestCase, ...) for i in range(batch_size)}
        schema = create_model('TestGenerationResult', **result_keys)

    if len(json.dumps(schema.model_json_schema())) > 15000:
        return _derive_completion_schema(batched, allowed_identifiers=None, batch_size=batch_size)

    return schema


class TestGenerator:
    def __init__(self, requirements_manager, environment, use_extended_reasoning=False):
        self.requirements_manager = requirements_manager
        self.environment = environment
        self.context_builder = VcastContextBuilder(self.environment)
        self.atg_context_builder = ATGContextBuilder(self.environment)
        self.llm_client = LLMClient()
        self.info_logger = InfoLogger()
        self.use_extended_reasoning = use_extended_reasoning

    def _group_requirements_into_batches(self, requirement_ids, batch_size):
        """Group requirements by function and split into batches of specified size."""
        # Group by function
        by_function = {}
        for req_id in requirement_ids:
            func = self.requirements_manager.get_function(req_id)
            if func not in by_function:
                by_function[func] = []
            by_function[func].append(req_id)
        
        # Split each function's requirements into batches
        batches = []
        for func_reqs in by_function.values():
            for i in range(0, len(func_reqs), batch_size):
                batches.append(func_reqs[i:i + batch_size])
        
        return batches

    async def generate_test_cases(self, requirement_ids, batched=True, allow_partial=False, allow_batch_partial=False, batch_size=8, **kwargs):
        if not requirement_ids:
            return

        if batched:
            # Split requirements into appropriate batches
            batches = self._group_requirements_into_batches(requirement_ids, batch_size)
            
            # Create generators
            generators = [self.generate_batched_test_cases(batch, allow_partial=allow_batch_partial, individual_partial=allow_partial, **kwargs) 
                        for batch in batches]
            
            async for test_case in merge(*generators):
                yield test_case

        else:
            routines = [self.generate_test_case(req_id, allow_partial=allow_partial, **kwargs) for req_id in requirement_ids]
            for test_case in asyncio.as_completed(routines):
                yield await test_case

    async def generate_batched_test_cases(self, requirement_ids, allow_partial=False, individual_partial=False, **kwargs):
        logging.info(f"Generating batched test cases: {requirement_ids}")
        if not requirement_ids:
            return

        for req_id in requirement_ids:
            self.info_logger.start_requirement(req_id)

        # Verify all requirements belong to the same function using requirements_manager
        functions = {self.requirements_manager.get_function(req_id) for req_id in requirement_ids}
        if len(functions) != 1:
            logging.warning("Requirements from different functions detected in batch. Falling back to individual generation.")
            async for test_case in self.generate_test_cases(requirement_ids, batched=False, allow_partial=individual_partial, **kwargs):
                yield test_case
            return

        function_name = functions.pop()
        requirements_text = "\n".join([f"{i+1}. {req_id}: {self.requirements_manager.get_description(req_id)}" for i, req_id in enumerate(requirement_ids)])

        # Build context similar to single test case generation
        context = await self.context_builder.build_code_context(function_name, include_unit_name=True)
        atg_examples = await self.atg_context_builder.get_relevant_test_cases(function_name, k=3, basis_path=True)

        with open(TEST_FRAMEWORK_REFERENCE_PATH, "r") as f:
            test_framework_reference = f.read()

        messages = [
            {
                "role": "system",
                "content": "You are an AI assistant that generates test code for given requirements."
            },
            {
                "role": "user",
                "content": f"""
Based on the following requirements, references, and code, generate one test case per given requirement that exercises it.

Test framework reference:
{test_framework_reference}

Relevant Code:
```cpp
{context}
```

Example Test Cases:
```json
{atg_examples}
```

Requirements:
{requirements_text}

Detailed task description:
Based on the above requirements and code, generate unit tests that exercise all requirements.
Make sure the generated test cases clearly test the provided requirements.

Solve the problem using the following approach:
For each requirement in order...
    1. Come up with descriptive (unique) name for the test case and describe in natural language how this test exercises the requirement
    2. Provide the name of the unit being tested (base file name without extension) and the name of the subprogram being tested (function name)
    3. Provide the input and expected values by providing the correct identifier and value in the syntax outlined above.

Notes:
- You are NOT allowed to invent any syntax that is not specified in the syntax reference. Stick to the syntax provided.
- You are NOT allowed to invent any units or functions that are not present in the provided code.
- This is a highly critical task, please ensure that the test cases are correct and complete and do not contain any logical or syntactical errors.
- Test cases are independent of each other, i.e., they should not rely on one being run before the other (or environment being modified by one).
- Generate exactly one test case per requirement.

Return your answer in the following format:
```json
{{
    "test_case_for_requirement_1": <test case testing the first requirement in the list>,
    "test_case_for_requirement_2": <test case testing the second requirement in the list>,
    ...
}}
```
"""
            }
        ]

        schema = _derive_completion_schema(True, allowed_identifiers=self.environment.allowed_identifiers, batch_size=len(requirement_ids))

        try:
            test_generation_result = await self.llm_client.call_model(messages, schema, temperature=0.0, extended_reasoning=self.use_extended_reasoning, max_tokens=4096)
        except Exception as e:
            logging.exception("Failed to generate batched test cases because model call failed. Falling back to individual generation.")
            async for test_case in self.generate_test_cases(requirement_ids, batched=False, allow_partial=individual_partial, **kwargs):
                yield test_case
            return

        test_cases = []
        for i, req_id in enumerate(requirement_ids):
            test_case = getattr(test_generation_result, f"test_case_for_requirement_{i+1}")
            test_cases.append(test_case)

        unseen_requirements = set(requirement_ids)

        async def process_generated_test_case(test_case):
            nonlocal unseen_requirements
            
            if test_case.requirement_id in unseen_requirements:
                unseen_requirements.remove(test_case.requirement_id)
            else:
                logging.warning(f"Requirement {test_case.requirement_id} was generated multiple times or was not requested.")

            output = self.environment.run_tests([test_case.to_vectorcast()], execute=True)
            errors, test_failures = self._parse_error_output(output)

            if errors or (not allow_partial and test_failures):
                self.info_logger.set_individual_test_generation_needed(test_case.requirement_id)
                if test_failures:
                    self.info_logger.set_test_run_failure_feedback(test_case.requirement_id)

                return await self.generate_test_case(test_case.requirement_id, already_started=True, allow_partial=individual_partial, **kwargs)
            else:
                self.info_logger.set_test_generated(test_case.requirement_id)

            if test_failures:
                self.info_logger.set_partial_test_generated(test_case.requirement_id)
                return test_case.as_partial
            else:
                return test_case

        for test_case in asyncio.as_completed([process_generated_test_case(test_case) for test_case in test_cases]):
            yield await test_case


        if unseen_requirements:
            routines = [self.generate_test_case(req_id, already_started=True, allow_partial=individual_partial, **kwargs) for req_id in unseen_requirements]
            for test_case in asyncio.as_completed(routines):
                yield await test_case

    async def generate_test_case(self, requirement_id, already_started=False, max_retries=1, allow_partial=False):
        try:
            if not already_started:
                self.info_logger.start_requirement(requirement_id)
            self.info_logger.set_individual_test_generation_needed(requirement_id)
            first_try = True
            for _ in range(max_retries):
                self.info_logger.increment_retries_used(requirement_id)
                temperature = 0.0 if first_try else 1.0
                extended_reasoning = self.use_extended_reasoning and not first_try  # Modify this line
                result = await self._generate_test_case_no_retries(requirement_id, temperature=temperature, extended_reasoning=extended_reasoning, allow_partial=allow_partial)
                if result:
                    self.info_logger.set_test_generated(requirement_id)
                    return result
                else:
                    first_try = False
        except Exception as e:
            import traceback
            logging.exception(f"Failed to generate test case for requirement {requirement_id}: {traceback.format_exc()}")

        return None

    async def _generate_test_case_no_retries(self, requirement_id, temperature=0, extended_reasoning=False, allow_partial=False):
        requirement_text = self.requirements_manager.get_description(requirement_id)
        if not requirement_text:
            logging.warning(f"Requirement {requirement_id} not found.")
            return None

        function_name = self.requirements_manager.get_function(requirement_id)
        if not function_name:
            logging.warning(f"Function not found for requirement {requirement_id}.")
            return None

        # Build code context using the environment
        context = await self.context_builder.build_code_context(function_name, include_unit_name=True)
        logging.debug("Generated code context: %s", context)
        
        # Determine number of example test cases based on context length
        context_lines = len(context.strip().split('\n'))
        if context_lines < 200:
            num_examples = 1
            basis_path = False
        else:
            num_examples = 3
            basis_path = False

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

        schema = _derive_completion_schema(False, allowed_identifiers=self.environment.allowed_identifiers)

        try:
            test_generation_result = await self.llm_client.call_model(messages, schema, temperature=temperature, extended_reasoning=extended_reasoning, max_tokens=4096)
            # Removed for_requirement parameter
        except Exception as e:
            logging.exception("Failed to generate test case.")
            return None

        test_generation_result = await self._iterative_error_correction(
            requirement_id, test_generation_result, messages, schema, temperature=temperature, extended_reasoning=extended_reasoning, allow_partial=allow_partial, allow_early_partial=True)

        if test_generation_result is None:
            return None

        return test_generation_result.test_case

    async def _iterative_error_correction(self, requirement_id, test_generation_result, messages, schema, temperature=0.0, extended_reasoning=False, max_iterations=3, allow_partial=False, allow_early_partial=False):
        iteration = 0
        fix_messages = messages
        while iteration < max_iterations:
            iteration += 1

            output = self.environment.run_tests([test_generation_result.test_case.to_vectorcast()], execute=True)
            errors, test_failures = self._parse_error_output(output)

            if not errors and not test_failures:
                break

            if not errors and allow_partial and allow_early_partial:
                return self._create_partial_test_case(test_generation_result)

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
                test_generation_result = await self.llm_client.call_model(fix_messages, schema, temperature=temperature, extended_reasoning=extended_reasoning, max_tokens=4096)

        if errors:
            logging.warning(f"Failed to fix errors after {iteration} iterations")
            return None
        elif test_failures:
            if allow_partial:
                logging.info("Converting to partial test case due to persistent test failures")
                return self._create_partial_test_case(test_generation_result)
            else:
                return None

        return test_generation_result

    def _create_partial_test_case(self, test_generation_result):
        partial_result = test_generation_result.model_copy(deep=True)
        partial_result.test_case = partial_result.test_case.as_partial
        self.info_logger.set_partial_test_generated(partial_result.test_case.requirement_id)
        return partial_result

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