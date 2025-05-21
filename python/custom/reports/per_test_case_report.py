from vector.apps.ReportBuilder.custom_report import CustomReport


class PerTestCaseReport(CustomReport):
    title = "Execution Results Report"
    default_testcase_sections = ["EXECUTION_RESULTS"]

    @classmethod
    def default_filename(cls):
        return "execution_results"

    def initialize(self, **kwargs):
        self.include_valid_sections(["TESTCASE_SECTIONS"])


# EOF
