class InfoLogger:
    def __init__(self):
        self.data = {}

    def start_requirement(self, requirement_id):
        self.data[requirement_id] = {
            'individual_test_generation_needed': False,
            'error_correction_needed': False,
            'retries_used': 0,
            'test_run_failure_feedback': False,
            'test_generated': False
        }

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
