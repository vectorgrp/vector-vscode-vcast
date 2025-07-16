import json
import logging
from types import SimpleNamespace
from typing import List, Optional, Tuple, Dict, Any
from pydantic import Field, create_model, BaseModel
import time

from autoreq.test_generation.identifier_type_gen import create_identifier_type
from autoreq.test_generation.generic_models import (
    GenericValueMapping,
    GenericTestCase,
    GenericTestGenerationResult,
)


# Define the new Pydantic model for schema generation information
class SchemaGenerationInfo(BaseModel):
    """
    Information about the generated schema and how it was derived.
    """

    no_identifiers_found: bool
    used_atg_identifiers: bool
    too_many_identifiers: bool
    input_identifiers: List[str]
    expected_identifiers: List[str]


class SchemaBuilder:
    def __init__(
        self,
        environment,
        max_identifier_array_index: int = 32,
        default_schema_identifier_type=None,
    ):
        self.environment = environment
        self.max_identifier_array_index = max_identifier_array_index
        self.default_schema_identifier_type = default_schema_identifier_type

    def _derive_test_case_schema(
        self,
        allowed_input_identifiers: List[str],
        allowed_expected_identifiers: List[str],
        relaxed: bool = False,
    ):
        return _construct_test_case_schema(
            allowed_input_identifiers, allowed_expected_identifiers, relaxed=relaxed
        )

    def derive_completion_schema(
        self,
        function_name: str,
        batched: bool = False,
        batch_size: int = None,
        focus_lines: List[int] = None,
        verify_schema: bool = True,
        identifier_type: str = None,
        relaxed_schema: bool = False,
        return_schema_gen_info: bool = False,
    ) -> Tuple[type, SchemaGenerationInfo]:
        schema_gen_info = SchemaGenerationInfo(
            no_identifiers_found=False,
            used_atg_identifiers=False,
            too_many_identifiers=False,
            input_identifiers=[],
            expected_identifiers=[],
        )

        if identifier_type is None:
            identifier_type = self.default_schema_identifier_type or 'input_expected'

        if identifier_type == 'input_expected':
            allowed_input_identifiers, used_atg_identifiers_input = (
                self.environment.get_allowed_identifiers_for_function(
                    function_name,
                    return_used_atg_fallback=True,
                    max_array_index=self.max_identifier_array_index,
                    focus_lines=focus_lines,
                    remove_surely_stubbed_inputs=True,
                    remove_surely_stubbed_returns=False,
                )
            )
            allowed_expected_identifiers, used_atg_identifiers_expected = (
                self.environment.get_allowed_identifiers_for_function(
                    function_name,
                    return_used_atg_fallback=True,
                    max_array_index=self.max_identifier_array_index,
                    focus_lines=focus_lines,
                    remove_surely_stubbed_inputs=False,
                    remove_surely_stubbed_returns=True,
                )
            )

            schema_gen_info.used_atg_identifiers = (
                used_atg_identifiers_input or used_atg_identifiers_expected
            )

            found_no_allowed_identifiers = (
                len(allowed_input_identifiers) == 0
                and len(allowed_expected_identifiers) == 0
            )
            schema_gen_info.no_identifiers_found = found_no_allowed_identifiers

            logging.info(
                f'Creating schema with {len(allowed_input_identifiers)} allowed input identifiers and '
                f'{len(allowed_expected_identifiers)} allowed expected identifiers for function {function_name}'
            )
        elif identifier_type == 'unified':
            allowed_input_identifiers, used_atg_identifiers = (
                self.environment.get_allowed_identifiers_for_function(
                    function_name,
                    return_used_atg_fallback=True,
                    max_array_index=self.max_identifier_array_index,
                    focus_lines=focus_lines,
                    remove_surely_stubbed_inputs=False,
                    remove_surely_stubbed_returns=False,
                )
            )
            allowed_expected_identifiers = allowed_input_identifiers
            schema_gen_info.used_atg_identifiers = used_atg_identifiers

            found_no_allowed_identifiers = len(allowed_input_identifiers) == 0
            schema_gen_info.no_identifiers_found = found_no_allowed_identifiers

            logging.info(
                f'Creating schema with {len(allowed_input_identifiers)} allowed identifiers for function {function_name}'
            )
        else:
            allowed_input_identifiers = None
            allowed_expected_identifiers = None

        too_many_identifiers = (
            allowed_input_identifiers is not None
            and len(allowed_input_identifiers) > 250
        ) or (
            allowed_expected_identifiers is not None
            and len(allowed_expected_identifiers) > 250
        )
        if too_many_identifiers and not relaxed_schema:
            logging.warning(
                f'Function {function_name} has too many identifiers: '
                f'{len(allowed_input_identifiers)} input and {len(allowed_expected_identifiers)} expected. Relaxing schema.'
            )
            schema_gen_info.too_many_identifiers = True
            relaxed_schema = True

        schema_gen_info.input_identifiers = allowed_input_identifiers or []
        schema_gen_info.expected_identifiers = allowed_expected_identifiers or []

        TestCaseClass = self._derive_test_case_schema(
            allowed_input_identifiers,
            allowed_expected_identifiers,
            relaxed=relaxed_schema,
        )

        schema = _construct_completion_schema(TestCaseClass, batched, batch_size)

        schema_json = json.dumps(schema.model_json_schema())
        logging.info(f'Generated schema size: {len(schema_json)} chars')

        if verify_schema:
            schema_issues = _validate_openai_structured_output_schema(
                schema.model_json_schema()
            )
        else:
            schema_issues = []

        if schema_issues:
            logging.warning(
                f'Schema has issues that make it illegal to use (i.e. it is too big):\\n{chr(10).join(schema_issues)}\\n\\nRetrying creation without specific allowed identifiers for a smaller schema.'
            )

            if identifier_type == 'input_expected':
                fallback_type = 'unified'
            else:
                fallback_type = 'generic'

            schema = self.derive_completion_schema(
                function_name=function_name,
                batched=batched,
                batch_size=batch_size,
                identifier_type=fallback_type,
                verify_schema=fallback_type
                != 'generic',  # Check unless we already have the generic schema
                return_schema_gen_info=False,  # No need to return flags for the fallback schema
            )

            schema_gen_info.too_many_identifiers = True

        if return_schema_gen_info:
            return schema, schema_gen_info

        return schema


def create_schema_instance_mock(instance_data: Dict[str, Any]) -> BaseModel:
    """
    Dynamically infers the schema from instance_data, synthesizes it,
    validates the data, and returns the parsed Pydantic model.

    Args:
        instance_data: A dictionary representing an instance of a schema
                       (e.g., TestCase, TestGenerationResult, or batched TestGenerationResult).

    Returns:
        A validated Pydantic model instance.

    Raises:
        ValueError: If the schema type cannot be determined or data is malformed.
    """
    if not isinstance(instance_data, dict):
        raise ValueError('Input data must be a dictionary.')

    # Try to infer if it's a single TestGenerationResult (contains 'test_case')
    if 'test_case' in instance_data:
        test_case_content = instance_data.get('test_case')
        if not isinstance(test_case_content, dict):
            raise ValueError(
                "'test_case' value must be a dictionary for a single TestGenerationResult."
            )

        TestCaseModel = _construct_test_case_schema(None, None)
        FinalModel = _construct_completion_schema(
            TestCaseModel, batched=False, batch_size=None
        )
        return FinalModel.model_validate(instance_data)

    # Try to infer if it's a batched TestGenerationResult
    elif any(k.startswith('test_case_for_requirement_') for k in instance_data):
        batch_items = {
            k: v
            for k, v in instance_data.items()
            if k.startswith('test_case_for_requirement_')
        }

        TestCaseModel = _construct_test_case_schema(None, None)
        FinalModel = _construct_completion_schema(
            TestCaseModel, batched=True, batch_size=len(batch_items)
        )
        return FinalModel.model_validate(instance_data)

    # Try to infer if it's a direct TestCase (has 'input_values' or 'expected_values' but not 'test_case' or batch keys)
    elif 'input_values' in instance_data or 'expected_values' in instance_data:
        TestCaseModel = _construct_test_case_schema(None, None)
        return TestCaseModel.model_validate(instance_data)
    else:
        return json.loads(
            json.dumps(instance_data), object_hook=lambda x: SimpleNamespace(**x)
        )  # Fallback to a simple namespace


def _construct_test_case_schema(
    allowed_input_identifiers: List[str],
    allowed_expected_identifiers: List[str],
    relaxed: bool = False,
):
    if relaxed:
        InputIdentifier = str
        ExpectedIdentifier = str
    else:
        InputIdentifier = create_identifier_type(allowed_input_identifiers)
        ExpectedIdentifier = create_identifier_type(allowed_expected_identifiers)

    unique_suffix = int(time.time() * 1000)

    InputValueMappingName = f'InputValueMapping_{unique_suffix}'
    InputValueMappingGlobal = type(
        InputValueMappingName,
        (GenericValueMapping,),  # Use imported class
        {'__annotations__': {'identifier': InputIdentifier}},
    )

    ExpectedValueMappingName = f'ExpectedValueMapping_{unique_suffix}'
    ExpectedValueMappingGlobal = type(
        ExpectedValueMappingName,
        (GenericValueMapping,),  # Use imported class
        {'__annotations__': {'identifier': ExpectedIdentifier}},
    )

    TestCaseName = f'TestCase_{unique_suffix}'
    TestCaseGlobal = type(
        TestCaseName,
        (GenericTestCase,),  # Use imported class
        {
            '__annotations__': {
                'input_values': List[InputValueMappingGlobal],
                'expected_values': List[ExpectedValueMappingGlobal],
            },
            'input_values': Field(default_factory=list),
            'expected_values': Field(default_factory=list),
        },
    )
    return TestCaseGlobal


def _construct_completion_schema(
    TestCaseClass: Any, batched: Optional[bool], batch_size: Optional[int]
):
    if not batched:
        TestGenerationResultClass = create_model(
            'TestGenerationResult',
            test_case=(TestCaseClass, ...),
            __base__=GenericTestGenerationResult,
        )
        schema = TestGenerationResultClass
    else:
        assert batch_size is not None
        result_keys = {}
        for i in range(batch_size):
            field_name = f'test_case_for_requirement_{i + 1}'
            result_keys[field_name] = (TestCaseClass, ...)
        # For batched results, the top-level model doesn't directly use GenericTestGenerationResult as a base
        # but is a dynamic model holding multiple TestCaseClass instances.
        schema = create_model('TestGenerationResult', **result_keys)
    return schema


def _validate_openai_structured_output_schema(schema) -> List[str]:
    """
    Validate a pydantic model schema against nesting, size, enum, and additionalProperties rules.
    Based on the OpenAI API schema validation rules here: https://platform.openai.com/docs/guides/structured-outputs?api-mode=chat
    """
    errors: List[str] = []
    total_props = 0
    total_string_len = 0
    total_enum_vals = 0

    def traverse(node: dict, depth: int):
        nonlocal total_props, total_string_len, total_enum_vals
        max_nesting = 5
        max_total_props = 100
        if depth > max_nesting:
            errors.append(f'Exceeded max nesting depth: {depth} > 5')
        # object checks
        if node.get('type') == 'object':
            props = node.get('properties', {})
            total_props += len(props)
            if len(props) and total_props > max_total_props:
                errors.append(f'Total properties {total_props} exceeds limit of 100')
            # TODO: Ideally we would check for additionalProperties here, but it is not actually present in pydantic generated schemas (and yet it still somehow works)
            # if node.get('additionalProperties', True) is not False:
            #    errors.append("'additionalProperties' must be false on all objects")
            for name, subs in props.items():
                total_string_len += len(name)
                traverse(subs, depth + 1)
        # enum checks
        max_vals = 250
        max_enum_len = 7500
        if node.get('type') == 'string' and 'enum' in node:
            vals = node['enum']
            count = len(vals)
            total_enum_vals += count
            enum_len = sum(len(str(v)) for v in vals)
            total_string_len += enum_len
            if count > max_vals and enum_len > max_enum_len:
                errors.append(
                    f'Enum property has {count} values and total length {enum_len} exceeds 7500'
                )
        # const check
        if 'const' in node:
            total_string_len += len(str(node['const']))
        # definitions and combinators
        for key in ('$defs', 'definitions', 'allOf', 'anyOf', 'oneOf'):
            items = node.get(key, {})
            if isinstance(items, dict):
                iterable = items.values()
            else:
                iterable = items
            for child in iterable:
                traverse(child, depth)

    traverse(schema, 1)
    max_string_len = 15000
    if total_string_len > max_string_len:
        errors.append(
            f'Total string length {total_string_len} exceeds limit of 15000 characters'
        )
    max_enum_vals = 500
    if total_enum_vals > max_enum_vals:
        errors.append(f'Total enum values {total_enum_vals} exceeds limit of 500')

    return errors
