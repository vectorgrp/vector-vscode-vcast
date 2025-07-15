from collections import defaultdict
import asyncio
from aiostream.stream import merge
import re
from async_lru import alru_cache
from pydantic import create_model
from dotenv import load_dotenv
import logging

from autoreq.test_generation.test_patcher import TestPatcher
from autoreq.util import get_relevant_statement_groups

from autoreq.test_generation.vcast_context_builder import VcastContextBuilder
from autoreq.test_generation.atg_context_builder import ATGContextBuilder
from autoreq.test_generation.info_logger import InfoLogger
from autoreq.test_generation.schema_builder import SchemaBuilder
from ..constants import TEST_FRAMEWORK_REFERENCE_PATH
from ..llm_client import LLMClient

# Load environment variables from .env file
load_dotenv()


class TestGenerator:
    def __init__(
        self,
        requirements_manager,
        environment,
        use_extended_reasoning=False,
        min_prune_lines=1000,
        use_test_examples=True,  # TODO: This can probably be disabled soon, some C++ features would need to be represented in the test framework examples though
        schema_type='unified',  # TODO: input_expected could work a bit better for some C code when pruning, so keep that in mind for the future
        add_prompt_identifiers_when_unpruned=True,
        blackbox=False,
        with_test_patcher=True,
    ):
        self.requirements_manager = requirements_manager
        self.environment = environment
        self.llm_client = LLMClient()
        self.atg_context_builder = ATGContextBuilder(self.environment)
        self.context_builder = VcastContextBuilder(
            self.environment, llm_client=self.llm_client
        )
        self.info_logger = InfoLogger()
        self.use_extended_reasoning = use_extended_reasoning
        self.schema_builder = SchemaBuilder(
            self.environment, default_schema_identifier_type=schema_type
        )
        self.min_prune_lines = min_prune_lines
        self.use_test_examples = use_test_examples
        self.add_prompt_identifiers_when_unpruned = add_prompt_identifiers_when_unpruned
        self.schema_type = schema_type
        self.blackbox = blackbox

        if with_test_patcher:
            self.test_patcher = TestPatcher(self.environment)
        else:
            self.test_patcher = None

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
                batches.append(func_reqs[i : i + batch_size])

        return batches

    async def generate_test_cases(
        self,
        requirement_ids,
        batched=True,
        allow_partial=False,
        allow_batch_partial=False,
        batch_size=8,
        **kwargs,
    ):
        if not requirement_ids:
            return

        if batched:
            # Split requirements into appropriate batches
            batches = self._group_requirements_into_batches(requirement_ids, batch_size)

            # Create generators
            generators = [
                self.generate_batched_test_cases(
                    batch,
                    allow_partial=allow_batch_partial,
                    individual_partial=allow_partial,
                    **kwargs,
                )
                for batch in batches
            ]

            async for test_case in merge(*generators):
                yield test_case

        else:
            routines = [
                self.generate_test_case(req_id, allow_partial=allow_partial, **kwargs)
                for req_id in requirement_ids
            ]
            for test_case in asyncio.as_completed(routines):
                yield await test_case

    async def generate_batched_test_cases(
        self, requirement_ids, allow_partial=False, individual_partial=False, **kwargs
    ):
        logging.info(f'Generating batched test cases: {requirement_ids}')
        if not requirement_ids:
            return

        for req_id in requirement_ids:
            self.info_logger.start_requirement(req_id)

        # Verify all requirements belong to the same function using requirements_manager
        functions = {
            self.requirements_manager.get_function(req_id) for req_id in requirement_ids
        }
        if len(functions) != 1:
            logging.warning(
                'Requirements from different functions detected in batch. Falling back to individual generation.'
            )
            async for test_case in self.generate_test_cases(
                requirement_ids,
                batched=False,
                allow_partial=individual_partial,
                **kwargs,
            ):
                yield test_case
            return

        # Extract basic function info
        function_name = functions.pop()
        func_body = self.environment.tu_codebase.find_definitions_by_name(
            function_name
        )[0]
        num_lines = len(func_body.split('\n'))

        # Extract relevant function lines
        if num_lines >= self.min_prune_lines:
            requirement_relevant_lines_map = (
                await self._relevant_lines_for_all_func_requirements(function_name)
            )
            relevant_lines = tuple(
                set(
                    line
                    for req_id in requirement_ids
                    for line in requirement_relevant_lines_map[req_id]
                )
            )
        else:
            relevant_lines = None

        requirements_text = '\n'.join(
            [
                f'{i + 1}. {req_id}: {self.requirements_manager.get_description(req_id)}'
                for i, req_id in enumerate(requirement_ids)
            ]
        )

        # Build code context
        context, used_fallback = await self.context_builder.build_code_context(
            function_name,
            include_unit_name=True,
            return_used_fallback=True,
            focus_lines=relevant_lines,
            blackbox=self.blackbox,
        )
        for req_id in requirement_ids:
            self.info_logger.set_used_code_context_fallback(req_id, used_fallback)

        # Build ATG context
        context_lines = len(context.strip().split('\n'))
        max_context_lines = 200
        basis_path = True
        num_examples = 3
        if context_lines < max_context_lines:
            num_examples = 1

        atg_examples = await self.atg_context_builder.get_relevant_test_cases(
            function_name, k=num_examples, basis_path=basis_path
        )
        for req_id in requirement_ids:
            self.info_logger.set_no_atg_examples(req_id, len(atg_examples) == 0)

        if num_examples > 0 and self.use_test_examples:
            example_test_cases_section = f"""
Example Test Cases:
```json
{atg_examples}
```
"""
        else:
            example_test_cases_section = ''

        with open(TEST_FRAMEWORK_REFERENCE_PATH, 'r') as f:
            test_framework_reference = f.read()

        schema, gen_info = self.schema_builder.derive_completion_schema(
            function_name=function_name,
            batched=True,
            batch_size=len(requirement_ids),
            focus_lines=relevant_lines,
            return_schema_gen_info=True,
        )

        for req_id in requirement_ids:
            self.info_logger.set_schema_exceeded_size(
                req_id, gen_info.too_many_identifiers
            )
            self.info_logger.set_found_no_allowed_identifiers(
                req_id, gen_info.no_identifiers_found
            )
            self.info_logger.set_used_atg_identifier_fallback(
                req_id, gen_info.used_atg_identifiers
            )

        # If we prune, we can also give identifiers
        identifier_section = self._build_identifier_section(
            gen_info.input_identifiers, gen_info.expected_identifiers, num_lines
        )

        stubbed_functions_section = self._build_stubbed_functions_section(function_name)

        messages = [
            {
                'role': 'system',
                'content': 'You are an AI assistant that generates test code for given requirements.',
            },
            {
                'role': 'user',
                'content': f"""
Based on the following requirements, references, and code, generate one test case per given requirement that exercises it.

Test framework reference:
{test_framework_reference}

Relevant Code:
```cpp
{context}
```
{example_test_cases_section}
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
{identifier_section}
{stubbed_functions_section}
Notes:
- You are NOT allowed to invent any syntax that is not specified in the syntax reference. Stick to the syntax provided.
- You are NOT allowed to invent any units or functions that are not present in the provided code.
- This is a highly critical task, please ensure that the test cases are correct and complete and do not contain any logical or syntactical errors.
- Test cases are independent of each other, i.e., they should not rely on one being run before the other (or environment being modified by one).
- Generate exactly one test case per requirement.
- In case the requirement and the code differ, the requirement is what you should test, i.e., it is the source of truth.
- It might be that some of the provided code context and identifiers are incorrect. Use the most obviously correct parts of both and ignore the rest.

Return your answer in the following format:
```json
{{
    "test_case_for_requirement_1": <test case testing the first requirement in the list>,
    "test_case_for_requirement_2": <test case testing the second requirement in the list>,
    ...
}}
```
""",
            },
        ]

        try:
            test_generation_result = await self.llm_client.call_model(
                messages,
                schema,
                temperature=0.0,
                extended_reasoning=self.use_extended_reasoning,
                max_tokens=8192,
            )
        except Exception as e:
            import traceback

            logging.exception(f'Call to model failed for batched requirements: {e}')
            logging.exception(
                'Failed to generate batched test cases because model call failed. Falling back to individual generation.'
            )

            for req_id in requirement_ids:
                self.info_logger.add_exception(req_id, traceback.format_exc())

            async for test_case in self.generate_test_cases(
                requirement_ids,
                batched=False,
                allow_partial=individual_partial,
                **kwargs,
            ):
                yield test_case
            return

        test_cases = []
        for i, req_id in enumerate(requirement_ids):
            test_case = getattr(
                test_generation_result, f'test_case_for_requirement_{i + 1}'
            )
            test_cases.append(test_case)

        unseen_requirements = set(requirement_ids)

        async def process_generated_test_case(test_case):
            nonlocal unseen_requirements

            if test_case.requirement_id in unseen_requirements:
                unseen_requirements.remove(test_case.requirement_id)
            else:
                logging.warning(
                    f'Requirement {test_case.requirement_id} was generated multiple times or was not requested.'
                )

            errors, test_failures = self._run_test_case_and_report(test_case)

            if errors or (not allow_partial and test_failures):
                self.info_logger.set_individual_test_generation_needed(
                    test_case.requirement_id
                )
                # TODO: Think about if we want to set this or not
                # if test_failures:
                #    self.info_logger.set_test_run_failure_feedback(test_case.requirement_id)

                return await self.generate_test_case(
                    test_case.requirement_id,
                    already_started=True,
                    allow_partial=individual_partial,
                    **kwargs,
                )
            else:
                self.info_logger.set_test_generated(test_case.requirement_id)

            if test_failures:
                self.info_logger.set_partial_test_generated(test_case.requirement_id)
                return self._patch_test_case(test_case.as_partial)
            else:
                return self._patch_test_case(test_case)

        for test_case in asyncio.as_completed(
            [process_generated_test_case(test_case) for test_case in test_cases]
        ):
            yield await test_case

        if unseen_requirements:
            routines = [
                self.generate_test_case(
                    req_id,
                    already_started=True,
                    allow_partial=individual_partial,
                    **kwargs,
                )
                for req_id in unseen_requirements
            ]
            for test_case in asyncio.as_completed(routines):
                yield await test_case

    async def generate_test_case(
        self, requirement_id, already_started=False, max_retries=1, allow_partial=False
    ):
        try:
            if not already_started:
                self.info_logger.start_requirement(requirement_id)

            self.info_logger.set_individual_test_generation_needed(requirement_id)

            first_try = True
            for i in range(max_retries):
                self.info_logger.increment_retries_used(requirement_id)
                # temperature = 0.0 if first_try else 1.0
                temperature = 0.0
                # extended_reasoning = self.use_extended_reasoning and not first_try
                extended_reasoning = self.use_extended_reasoning
                result = await self._generate_test_case_no_retries(
                    requirement_id,
                    temperature=temperature,
                    extended_reasoning=extended_reasoning,
                    allow_partial=allow_partial,
                    reword_requirement=not first_try,
                    relax_schema=not first_try,
                )
                if result:
                    self.info_logger.set_test_generated(requirement_id)
                    return self._patch_test_case(result)
                else:
                    first_try = False
        except Exception:
            import traceback

            self.info_logger.add_exception(requirement_id, traceback.format_exc())
            logging.exception(
                f'Failed to generate test case for requirement {requirement_id}: {traceback.format_exc()}'
            )

        return None

    async def _generate_test_case_no_retries(
        self,
        requirement_id,
        temperature=0.0,
        extended_reasoning=False,
        allow_partial=False,
        reword_requirement=None,
        relax_schema=False,
    ):
        requirement_text = self.requirements_manager.get_description(requirement_id)
        if not requirement_text:
            logging.warning(f'Requirement {requirement_id} not found.')
            return None

        if reword_requirement:
            logging.info(f'Original requirement ({requirement_id}): {requirement_text}')
            requirement_text = await self.llm_client.call_model(
                messages=[
                    {
                        'role': 'system',
                        'content': 'You are an AI assistant that rewords requirements.',
                    },
                    {
                        'role': 'user',
                        'content': f'Reword the following requirement: {requirement_text}',
                    },
                ],
                schema=create_model(
                    'RewordedRequirement', reworded_requirement=(str, ...)
                ),
                extended_reasoning=extended_reasoning,
                temperature=temperature,
            )
            requirement_text = requirement_text.reworded_requirement
            logging.info(f'Reworded requirement ({requirement_id}): {requirement_text}')

        function_name = self.requirements_manager.get_function(requirement_id)
        if not function_name:
            logging.warning(f'Function not found for requirement {requirement_id}.')
            return None

        # Extract basic function info
        function_name = self.requirements_manager.get_function(requirement_id)
        func_body = self.environment.tu_codebase.find_definitions_by_name(
            function_name
        )[0]
        num_lines = len(func_body.split('\n'))

        # Extract relevant lines
        # TODO: Maybe have this lower than for batch
        if num_lines >= self.min_prune_lines:
            requirement_relevant_lines_map = (
                await self._relevant_lines_for_all_func_requirements(function_name)
            )
            relevant_lines = requirement_relevant_lines_map[requirement_id]
        else:
            relevant_lines = None

        # Build schema
        schema, gen_info = self.schema_builder.derive_completion_schema(
            function_name=function_name,
            batched=False,
            focus_lines=relevant_lines,
            return_schema_gen_info=True,
            relaxed_schema=relax_schema,
        )

        self.info_logger.set_schema_exceeded_size(
            requirement_id, gen_info.too_many_identifiers
        )
        self.info_logger.set_found_no_allowed_identifiers(
            requirement_id, gen_info.no_identifiers_found
        )
        self.info_logger.set_used_atg_identifier_fallback(
            requirement_id, gen_info.used_atg_identifiers
        )

        # If we prune, we can also give identifiers
        identifier_section = self._build_identifier_section(
            gen_info.input_identifiers, gen_info.expected_identifiers, num_lines
        )

        stubbed_functions_section = self._build_stubbed_functions_section(function_name)

        # Build code context
        context, used_fallback = await self.context_builder.build_code_context(
            function_name,
            include_unit_name=True,
            return_used_fallback=True,
            focus_lines=relevant_lines,
            blackbox=self.blackbox,
        )
        self.info_logger.set_used_code_context_fallback(requirement_id, used_fallback)
        logging.debug('Generated code context: %s', context)

        """
        func_code = self.environment.tu_codebase.find_definitions_by_name(function_name)[0]
        relevant_groups = await get_relevant_statement_groups(func_code, requirement_text)

        prettified_groups = []
        for i, part in enumerate(relevant_groups):
            index_prefix = f"{i+1}. "
            prettified_groups.append(index_prefix + str(part))

        groups_text = "\n".join(prettified_groups)
        """

        # Determine number of example test cases based on context length
        context_lines = len(context.strip().split('\n'))
        max_context_lines = 200
        if context_lines < max_context_lines:
            num_examples = 1
            basis_path = False
        else:
            num_examples = 3
            basis_path = False

        logging.info(f'Fetching {num_examples} ATG example test cases')
        atg_examples = await self.atg_context_builder.get_relevant_test_cases(
            function_name, k=num_examples, basis_path=basis_path
        )
        logging.debug('Retrieved ATG examples: %s', atg_examples)

        self.info_logger.set_no_atg_examples(requirement_id, len(atg_examples) == 0)

        with open(TEST_FRAMEWORK_REFERENCE_PATH, 'r') as f:
            test_framework_reference = f.read()

        if num_examples > 0 and self.use_test_examples:
            example_test_cases_section = f"""
Example Test Cases:
```json
{atg_examples}
```
"""
        else:
            example_test_cases_section = ''

        messages = [
            {
                'role': 'system',
                'content': 'You are an AI assistant that generates test code for given requirements.',
            },
            {
                'role': 'user',
                'content': f"""
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
{identifier_section}
{stubbed_functions_section}
Notes:
- You are NOT allowed to invent any syntax that is not specified in the syntax reference. Stick to the syntax provided.
- You are NOT allowed to invent any units or functions that are not present in the provided code.
- This is a highly critical task, please ensure that the test case is correct and complete and does not contain any logical or syntactical errors.
- Test cases are independent of each other, i.e., they should not rely on one being run before the other (or environment being modified by one).
- For each test case, make sure to set an input value for all arguments, global variables and stubs used in the function.
- For each test case, make sure to only set expected values precisely for what the requirement specifies. Nothing more, nothing less.
- In case the requirement and the code differ, the requirement is what you should test, i.e., it is the source of truth.
- Watch out for off-by-one errors
- It might be that some of the provided code context and identifiers are incorrect. Use the most obviously correct parts of both and ignore the rest.
""",
            },
        ]

        try:
            test_generation_result = await self.llm_client.call_model(
                messages,
                schema,
                temperature=temperature,
                extended_reasoning=extended_reasoning,
                max_tokens=4096,
            )
        except Exception as e:
            import traceback

            self.info_logger.add_exception(requirement_id, traceback.format_exc())
            logging.exception(
                f'Call to model failed for requirement {requirement_id}: {e}'
            )
            return None

        test_generation_result = await self._iterative_error_correction(
            requirement_id,
            test_generation_result,
            messages,
            schema,
            temperature=temperature,
            extended_reasoning=extended_reasoning,
            allow_partial=allow_partial,
            allow_early_partial=False,
            max_iterations=3,
            allow_test_feedback=False,
        )

        if test_generation_result is None:
            return None

        return test_generation_result.test_case

    @alru_cache(maxsize=4096)
    async def _relevant_lines_for_all_func_requirements(self, function_name):
        func_requirements = {
            req: self.requirements_manager.get_description(req)
            for req in self.requirements_manager.get_requirements_for_function(
                function_name
            )
        }
        func_body = self.environment.tu_codebase.find_definitions_by_name(
            function_name
        )[0]

        relevant_semantic_parts = await get_relevant_statement_groups(
            func_body, func_requirements.values(), llm_client=self.llm_client
        )

        result = {}
        for req, parts in zip(func_requirements, relevant_semantic_parts):
            relevant_line_numbers = tuple(
                set(line for group in parts for line in group.line_numbers)
            )
            result[req] = relevant_line_numbers

        return result

    def _build_identifier_section(
        self, input_identifiers, expected_identifiers, num_lines
    ):
        shown_input_identifiers = self._prune_identifier_list_for_display(
            input_identifiers
        )
        shown_expected_identifiers = self._prune_identifier_list_for_display(
            expected_identifiers
        )
        if len(shown_input_identifiers) > 0 and (
            self.add_prompt_identifiers_when_unpruned
            or num_lines >= self.min_prune_lines
        ):
            rendered_input_identifiers = '\n'.join(
                '- ' + i
                for i in shown_input_identifiers
                if 'USER_GLOBALS_VCAST' not in i
            )
            rendered_expected_identifiers = '\n'.join(
                '- ' + i
                for i in shown_expected_identifiers
                if 'USER_GLOBALS_VCAST' not in i
            )
            if self.schema_type == 'input_expected':
                identifier_section = f"""
You are allowed to use the following identifiers in your test case:
You must set an input value for each of the following identifiers:
{rendered_input_identifiers}

An expected value is not required for all identifiers. These are the ones you can set:
{rendered_expected_identifiers}
"""
            elif self.schema_type == 'unified':
                identifier_section = f"""
You are allowed to use the following identifiers in your test case:
{rendered_input_identifiers}

You MUST set an input value for all input to the functions, used globals and called stubs.
If you do not ensure this, it can happen that your test does not cover the correct path corresponding to the requirement.
An expected value is not required for all identifiers. Only for those relevant to the requirement.
"""
        else:
            identifier_section = ''

        return identifier_section

    def _prune_identifier_list_for_display(self, identifiers):
        # Remove USER_GLOBALS_VCAST identifiers
        identifiers = [
            ident for ident in identifiers if 'USER_GLOBALS_VCAST' not in ident
        ]

        INDEX_VARIABLE_NAMES = 'ijklmnopqrstuvwxyz'

        similar_identifiers = defaultdict(list)
        original_identifiers = {}
        for ident in identifiers:
            array_indices = []

            def arrayrepl(match):
                nonlocal array_indices
                array_indices.append(int(match.group(1)))
                var_name = INDEX_VARIABLE_NAMES[len(array_indices) - 1]
                return f'!!ARRAY_INDEX_PLACEHOLDER_{var_name}!!'

            normalized_ident = re.sub(r'\[(\d+)\]', arrayrepl, ident)
            similar_identifiers[normalized_ident].append(array_indices)
            original_identifiers[normalized_ident] = ident

        # Now combine similar identifiers
        combined_identifiers = []
        for ident, indices_list in similar_identifiers.items():
            if len(indices_list) == 1:
                combined_identifiers.append(original_identifiers[ident])
                continue

            index_minima = {}
            index_maxima = {}
            for indices in indices_list:
                for _i, index in enumerate(indices):
                    i = INDEX_VARIABLE_NAMES[_i]
                    if i not in index_minima:
                        index_minima[i] = index
                        index_maxima[i] = index
                    else:
                        index_minima[i] = min(index_minima[i], index)
                        index_maxima[i] = max(index_maxima[i], index)

            used_var_names = [
                var for var in INDEX_VARIABLE_NAMES if var in index_minima
            ]
            index_description = '(for all:'
            processed_ident = ident
            for i in used_var_names:
                if index_minima[i] == index_maxima[i]:
                    processed_ident = processed_ident.replace(
                        f'!!ARRAY_INDEX_PLACEHOLDER_{i}!!', f'[{index_minima[i]}]'
                    )
                else:
                    index_description += (
                        f' {i} in {index_minima[i]}..{index_maxima[i]},'
                    )

                    processed_ident = processed_ident.replace(
                        f'!!ARRAY_INDEX_PLACEHOLDER_{i}!!', f'[{i}]'
                    )

            index_description = index_description[:-1] + ')'
            combined_identifiers.append(f'{processed_ident} {index_description}')

        return combined_identifiers

    def _build_stubbed_functions_section(self, function_name):
        # TODO: Handle pruned functions
        called_function_names = [
            f.name.split('::')[-1]
            for f in self.environment.type_resolver.resolve(
                function_name
            ).called_functions
        ]

        if not called_function_names:
            return ''

        called_unstubbed_functions = []
        for name in called_function_names:
            definition = self.environment.tu_codebase.find_definitions_by_name(name)[0]
            if '{' and '}' in definition:
                called_unstubbed_functions.append(name)

        called_stubbed_functions = []
        for name in called_function_names:
            if name not in called_unstubbed_functions:
                called_stubbed_functions.append(name)

        section = ''
        if called_unstubbed_functions:
            section += f'Unstubbed-by-default called functions (implement behaviour unless an identifier is set in which case the respective function is stubbed) called by {function_name}:\n'
            for name in called_unstubbed_functions:
                section += f'- {name}\n'
        if called_stubbed_functions:
            section += f'Stubbed-by-default called functions (no behaviour is implemented, you can use identifiers to simulate a return value) called by {function_name}:\n'
            for name in called_stubbed_functions:
                section += f'- {name}\n'

        return section

    def _run_test_case_and_report(self, test_case):
        patched_test = self._patch_test_case(test_case)
        output = self.environment.run_tests([patched_test.to_vectorcast(add_uuid=True)])
        errors, test_failures = self._parse_error_output(output)

        return errors, test_failures

    def _patch_test_case(self, test_case):
        if self.test_patcher:
            return self.test_patcher.patch_test_case(test_case)
        else:
            return test_case

    async def _iterative_error_correction(
        self,
        requirement_id,
        test_generation_result,
        messages,
        schema,
        temperature=0.0,
        extended_reasoning=False,
        max_iterations=3,
        allow_partial=False,
        allow_early_partial=False,
        allow_test_feedback=False,
    ):
        # Schema is now passed directly, no need to modify this method
        iteration = 0
        fix_messages = messages
        while iteration < max_iterations:
            iteration += 1

            errors, test_failures = self._run_test_case_and_report(
                test_generation_result.test_case
            )

            if not allow_test_feedback:
                test_failures = None

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
                logging.info('Errors detected in test case. Iteration %d', iteration)
                fix_messages += [
                    {
                        'role': 'assistant',
                        'content': test_generation_result.model_dump_json(indent=4),
                    },
                    {
                        'role': 'user',
                        'content': f"""
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
- If you get different expected outputs than what you expect, carefully analyze:
    - If this is due to a discrepancy in the requirement and the code, the requirement is the source of truth, so you can leave the test case as is.
    - If it appears that the test framework is working differently than you expected, try to find an indirect way to test the requirement partially, i.e., just a correct return value instead of complex pointer logic
""",
                    },
                ]

                # with open(f"fix_messages_{requirement_id}.txt", "w") as f:
                #    for message in fix_messages:
                #        f.write(f"{message['role']}: {message['content']}\n\n")

                # Call the model to get the fixed test case
                try:
                    test_generation_result = await self.llm_client.call_model(
                        fix_messages,
                        schema,
                        temperature=temperature,
                        extended_reasoning=extended_reasoning,
                        max_tokens=4096,
                    )
                except Exception as e:
                    import traceback

                    self.info_logger.add_exception(
                        requirement_id, traceback.format_exc()
                    )
                    logging.exception(
                        f'Call to model failed for requirement {requirement_id} (during error correction): {e}'
                    )
                    return None

        errors, test_failures = self._run_test_case_and_report(
            test_generation_result.test_case
        )

        if errors:
            logging.warning(f'Failed to fix errors after {iteration} iterations')
            return None
        elif test_failures:
            if allow_partial:
                logging.info(
                    'Converting to partial test case due to persistent test failures'
                )
                return self._create_partial_test_case(test_generation_result)
            else:
                return None

        return test_generation_result

    def _create_partial_test_case(self, test_generation_result):
        partial_result = test_generation_result.model_copy(deep=True)
        partial_result.test_case = partial_result.test_case.as_partial
        self.info_logger.set_partial_test_generated(
            partial_result.test_case.requirement_id
        )
        return partial_result

    def _parse_error_output(self, output):
        error_lines = []
        test_fail_lines = []

        # Extract error messages starting with (E) and include indented lines
        lines = output.split('\n')
        collecting_error = False
        for line in lines:
            if re.match(r'\(E\)', line):
                if 'TEST.REQUIREMENT_KEY' in line:
                    continue  # Skip requirement key errors
                error_lines.append(line)
                collecting_error = True
                continue
            if collecting_error:
                collecting_error = False
                if line.startswith('    ') or line.strip() == '':
                    error_lines.append(line)
                    collecting_error = True

        # Check for compile errors
        compile_error_index = output.find('Compile Failed')
        # Include all lines after "Compile Failed"
        if compile_error_index != -1:
            compile_error_output = output[compile_error_index:]

            if compile_error_output.strip():
                error_lines.append(compile_error_output.strip())

        # Check for segfauls
        segfault_index = output.find('Segmentation Violation')
        if segfault_index != -1:
            error_lines.append(
                'Segmentation Violation detected. This usually means that the test case is leaving some input/global/stub values uninitialized or dereferencing null pointers.'
            )

        # Extract feedback from test execution
        for line in lines:
            if '========' in line:
                break
            elif re.search(r'\[\s+FAIL\s+\]', line):
                test_fail_lines.append(line.strip())
            elif re.search(r'\[\s+\]', line):
                test_fail_lines.append(line.strip())

        logging.debug('Output:\n%s', output)
        logging.debug('Errors:\n%s', '\n'.join(error_lines))
        logging.debug('Test Failures:\n%s', '\n'.join(test_fail_lines))

        return '\n'.join(error_lines) if error_lines else None, '\n'.join(
            test_fail_lines
        ) if test_fail_lines else None
