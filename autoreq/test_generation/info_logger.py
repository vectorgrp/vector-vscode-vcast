from collections import defaultdict

class InfoLogger:
    def __init__(self):
        self.data = defaultdict(lambda: {
            'individual_test_generation_needed': False,
            'error_correction_needed': False,
            'retries_used': 0,
            'test_run_failure_feedback': False,
            'test_generated': False,
            'partial_test_generated': False,
            'found_allowed_identifiers': False,
            'schema_exceeded_size': False,
            'found_atg_examples': False
        })

    def start_requirement(self, requirement_id):
        # Reset retries when starting/restarting a requirement
        self.data[requirement_id]['retries_used'] = 0

    def increment_retries_used(self, requirement_id):
        self.data[requirement_id]['retries_used'] += 1

    def set_error_correction_needed(self, requirement_id):
        self.data[requirement_id]['error_correction_needed'] = True

    def set_test_run_failure_feedback(self, requirement_id):
        self.data[requirement_id]['test_run_failure_feedback'] = True

    def set_individual_test_generation_needed(self, requirement_id):
        self.data[requirement_id]['individual_test_generation_needed'] = True

    def set_test_generated(self, requirement_id):
        self.data[requirement_id]['test_generated'] = True

    def set_partial_test_generated(self, requirement_id):
        self.data[requirement_id]['partial_test_generated'] = True
        
    def set_found_allowed_identifiers(self, requirement_id, found=True):
        self.data[requirement_id]['found_allowed_identifiers'] = found
        
    def set_schema_exceeded_size(self, requirement_id, exceeded=True):
        self.data[requirement_id]['schema_exceeded_size'] = exceeded

    def set_found_atg_examples(self, requirement_id, found=True):
        self.data[requirement_id]['found_atg_examples'] = found