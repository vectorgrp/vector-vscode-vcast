from copy import deepcopy
import logging

from autoreq.test_generation.generic_models import GenericValueMapping


class TestPatcher:
    def __init__(self, environment):
        self.env = environment

    def patch_test_case(self, test_case):
        test_case = deepcopy(test_case)

        uninitialized_pointers = self._get_unintialized_pointers(test_case)
        for pointer_id, size in uninitialized_pointers.items():
            insertion_pos = self._find_insertion_position(test_case, pointer_id)
            test_case.input_values.insert(
                insertion_pos,
                GenericValueMapping(identifier=pointer_id, value=f'<<malloc {size}>>'),
            )

        unconstructed_class_constructors = self._get_unconstructed_class_constructors(
            test_case
        )
        for (
            class_name,
            constructor_identifiers,
        ) in unconstructed_class_constructors.items():
            # If there are multiple constructors, we pick the first one.
            constructor_identifier = constructor_identifiers[0]
            insertion_pos = self._find_insertion_position(
                test_case, constructor_identifier
            )
            test_case.input_values.insert(
                insertion_pos,
                GenericValueMapping(identifier=constructor_identifier, value='0'),
            )

        return test_case

    def patch_test_cases(self, test_cases):
        return [self.patch_test_case(test_case) for test_case in test_cases]

    def _find_insertion_position(self, test_case, identifier_to_insert):
        for i, test_value in enumerate(test_case.input_values):
            if test_value.identifier.startswith(identifier_to_insert):
                return i
        return 0

    def _get_unconstructed_class_constructors(self, test_case):
        relevant_identifiers = self._get_relevant_identifiers(test_case)

        if relevant_identifiers is None:
            logging.warning(
                f'No relevant identifiers found for subprogram {test_case.subprogram_name}'
            )
            return {}

        constructor_ids = [
            i for i in relevant_identifiers if i.metadata.get('constructor_type')
        ]
        constructors_by_class = {}
        for ident in constructor_ids:
            class_name = ident.metadata.get('constructor_type').name
            if class_name not in constructors_by_class:
                constructors_by_class[class_name] = []
            constructors_by_class[class_name].append(str(ident))

        constructors_by_unconstructed_class = constructors_by_class.copy()
        for test_value in test_case.input_values:
            identifier = test_value.identifier
            for class_name, constructor_identifiers in constructors_by_class.items():
                if identifier in constructor_identifiers:
                    del constructors_by_unconstructed_class[class_name]

        # only construct params and used

        return constructors_by_unconstructed_class

    def _get_unintialized_pointers(self, test_case):
        relevant_identifiers = self._get_relevant_identifiers(test_case)

        if relevant_identifiers is None:
            logging.warning(
                f'No relevant identifiers found for subprogram {test_case.subprogram_name}'
            )
            return {}

        input_identifiers = [
            test_value.identifier for test_value in test_case.input_values
        ]

        uninitialized_pointer_ids = [
            i
            for i in relevant_identifiers
            if str(i) not in input_identifiers
            and (
                i.metadata.get('pointer_type')
                or i.metadata.get('unconstrained_array_type')
            )
        ]

        uninitialized_param_pointer_ids = [
            i
            for i in uninitialized_pointer_ids
            if 'param_for' in i.metadata
            and i.metadata['param_for'].name == test_case.subprogram_name
        ]

        uninitialized_global_pointer_ids = [
            i
            for i in uninitialized_pointer_ids
            if 'global_in' in i.metadata
            and i.metadata['global_in'].name == test_case.subprogram_name
        ]

        uninitialized_nonparam_but_used_pointer_ids = [
            i
            for i in uninitialized_pointer_ids
            if any(
                test_value.identifier.startswith(str(i))
                and test_value.identifier != str(i)
                for test_value in test_case.input_values
            )
        ]

        all_uninitialized_pointers = (
            uninitialized_param_pointer_ids
            + uninitialized_global_pointer_ids
            + uninitialized_nonparam_but_used_pointer_ids
        )

        # Calculate dynamic sizes for each pointer
        pointer_sizes = {}
        for pointer_id in all_uninitialized_pointers:
            pointer_str = str(pointer_id)
            pointer_sizes[pointer_str] = self._calculate_max_used_size(
                pointer_str, test_case
            )

        return pointer_sizes

    def _get_relevant_identifiers(self, test_case):
        """Get all identifiers relevant to the test case's subprogram."""
        # TODO: We should ensure somehow that this is always valid (not let the model generate this, remove atg example tests or generalize handling of overloaded functions in tyeresolver/everywhere else)
        function_type = self.env.type_resolver.resolve(test_case.subprogram_name)

        if function_type is None:
            logging.warning(f'No type found for subprogram {test_case.subprogram_name}')
            return None

        return function_type.to_vectorcast_identifiers(top_level=True, return_raw=True)

    def _calculate_max_used_size(self, identifier_str, test_case):
        """Calculate the maximum used size for a given identifier based on test case input values."""
        max_size = 1  # Default fallback size

        for test_value in test_case.input_values:
            test_identifier = test_value.identifier
            if (
                test_identifier.startswith(identifier_str)
                and test_identifier != identifier_str
            ):
                # Extract index from array/pointer access like "arr[0]" or "ptr[5]"
                remaining = test_identifier[len(identifier_str) :]
                if remaining.startswith('[') and ']' in remaining:
                    try:
                        index_str = remaining[1:].split(']')[0]
                        index = int(index_str)
                        max_size = max(max_size, index + 1)
                    except (ValueError, IndexError):
                        pass

        return max_size
