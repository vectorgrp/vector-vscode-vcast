class InfoLogger:
    def __init__(self):
        self.data = {}

    def start_requirement(self, requirement_id):
        self.data[requirement_id] = {
            'error_correction_needed': False,
            'retries_used': 0,
            'test_run_failure_feedback': False,
            'test_generated': False,
            'input_tokens': 0,
            'output_tokens': 0,
            'money_spent': 0.0
        }

    def increment_retries_used(self, requirement_id):
        self.data[requirement_id]['retries_used'] += 1

    def set_error_correction_needed(self, requirement_id):
        self.data[requirement_id]['error_correction_needed'] = True

    def set_test_run_failure_feedback(self, requirement_id):
        self.data[requirement_id]['test_run_failure_feedback'] = True

    def set_test_generated(self, requirement_id):
        self.data[requirement_id]['test_generated'] = True

    def update_tokens(self, requirement_id, input_tokens, output_tokens):
        input_cost = (input_tokens / 1000) * 0.00275
        output_cost = (output_tokens / 1000) * 0.011
        total_cost = input_cost + output_cost
        self.data[requirement_id]['input_tokens'] += input_tokens
        self.data[requirement_id]['output_tokens'] += output_tokens
        self.data[requirement_id]['money_spent'] += total_cost
