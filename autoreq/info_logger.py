from collections import defaultdict
import logging


class RequirementGenerationInfoLogger:
    def __init__(self):
        self.data = defaultdict(
            lambda: {
                "requirement_generation_failed": False,
                "postprocessing_failed": False,
                "function_name": None,
                "exceptions": [],
            }
        )

    def set_requirement_generation_failed(self, function_name):
        """Mark that requirement generation failed for this function"""
        self.data[function_name]["requirement_generation_failed"] = True
        logging.debug(
            f"Tracked requirement generation failure for function {function_name}"
        )

    def set_postprocessing_failed(self, function_name):
        """Mark that postprocessing failed for this function"""
        self.data[function_name]["postprocessing_failed"] = True
        logging.debug(f"Tracked postprocessing failure for function {function_name}")

    def add_exception(self, function_name, exception):
        """Add an exception that occurred during generation for this function"""
        self.data[function_name]["exceptions"].append(exception)
        logging.debug(f"Tracked exception for function {function_name}: {exception}")


class HighLevelRequirementGenerationInfoLogger:
    def __init__(self):
        self.data = defaultdict(
            lambda: {
                "high_level_generation_failed": False,
                "unit_name": None,
                "exceptions": [],
            }
        )

    def set_high_level_generation_failed(self, unit_name):
        """Mark that high-level requirement generation failed for this unit"""
        self.data[unit_name]["high_level_generation_failed"] = True
        self.data[unit_name]["unit_name"] = unit_name
        logging.debug(
            f"Tracked high-level requirement generation failure for unit {unit_name}"
        )

    def add_exception(self, unit_name, exception):
        """Add an exception that occurred during high-level generation for this unit"""
        self.data[unit_name]["exceptions"].append(exception)
        self.data[unit_name]["unit_name"] = unit_name
        logging.debug(f"Tracked high-level exception for unit {unit_name}: {exception}")


class TestGenerationInfoLogger:
    def __init__(self):
        self.data = defaultdict(
            lambda: {
                "individual_test_generation_needed": False,
                "error_correction_needed": False,
                "retries_used": 0,
                "test_run_failure_feedback": False,
                "test_generated": False,
                "partial_test_generated": False,
                "found_no_allowed_identifiers": False,
                "schema_exceeded_size": False,
                "no_atg_examples": False,
                "used_code_context_fallback": False,
                "used_atg_identifier_fallback": False,
                "exceptions": [],
            }
        )

    def start_requirement(self, requirement_id):
        # Reset retries when starting/restarting a requirement
        self.data[requirement_id]["retries_used"] = 0

    def increment_retries_used(self, requirement_id):
        self.data[requirement_id]["retries_used"] += 1
        logging.debug(
            f'Incremented retries for requirement {requirement_id} to {self.data[requirement_id]["retries_used"]}'
        )

    def set_error_correction_needed(self, requirement_id):
        self.data[requirement_id]["error_correction_needed"] = True
        logging.debug(
            f"Tracked error correction needed for requirement {requirement_id}"
        )

    def set_test_run_failure_feedback(self, requirement_id):
        self.data[requirement_id]["test_run_failure_feedback"] = True
        logging.debug(
            f"Tracked test run failure feedback for requirement {requirement_id}"
        )

    def set_individual_test_generation_needed(self, requirement_id):
        self.data[requirement_id]["individual_test_generation_needed"] = True
        logging.debug(
            f"Tracked individual test generation needed for requirement {requirement_id}"
        )

    def set_test_generated(self, requirement_id):
        self.data[requirement_id]["test_generated"] = True
        logging.debug(f"Tracked test generated for requirement {requirement_id}")

    def set_partial_test_generated(self, requirement_id):
        self.data[requirement_id]["partial_test_generated"] = True
        logging.debug(
            f"Tracked partial test generated for requirement {requirement_id}"
        )

    def set_found_no_allowed_identifiers(self, requirement_id, not_found=True):
        self.data[requirement_id]["found_no_allowed_identifiers"] = not_found
        logging.debug(
            f"Tracked found no allowed identifiers ({not_found}) for requirement {requirement_id}"
        )

    def set_schema_exceeded_size(self, requirement_id, exceeded=True):
        self.data[requirement_id]["schema_exceeded_size"] = exceeded
        logging.debug(
            f"Tracked schema exceeded size ({exceeded}) for requirement {requirement_id}"
        )

    def set_no_atg_examples(self, requirement_id, no_examples=True):
        self.data[requirement_id]["no_atg_examples"] = no_examples
        logging.debug(
            f"Tracked no ATG examples ({no_examples}) for requirement {requirement_id}"
        )

    def set_used_code_context_fallback(self, requirement_id, used=True):
        self.data[requirement_id]["used_code_context_fallback"] = used
        logging.debug(
            f"Tracked used code context fallback ({used}) for requirement {requirement_id}"
        )

    def set_used_atg_identifier_fallback(self, requirement_id, used=True):
        self.data[requirement_id]["used_atg_identifier_fallback"] = used
        logging.debug(
            f"Tracked used ATG identifier fallback ({used}) for requirement {requirement_id}"
        )

    def add_exception(self, requirement_id, exception):
        self.data[requirement_id]["exceptions"].append(exception)
        logging.debug(
            f"Tracked exception for requirement {requirement_id}: {type(exception).__name__}: {exception}"
        )
