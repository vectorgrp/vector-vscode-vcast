import functools

from vector.apps.ReportBuilder.sections.mcdc_tables import McdcTables
from vector.apps.DataAPI.coverdb import InstrumentedFunction


class PatchMcdcDecisions:
    def __init__(self, api, orig):
        self.__api = api
        self.__orig = orig

    def __get__(self, instance, owner):
        data = self.__orig.__get__(instance, owner)
        mcdc_filter = self.__api.mcdc_filter
        unit_filter = mcdc_filter.get("unit")
        line_filter = mcdc_filter["line"]
        # Filter the data
        new_data = []
        for decn in data:
            if decn.start_line != line_filter:
                continue
            # When a unit is specified, also match the instrumented file name.
            # When omitted (included-header case), accept all TUs.
            if unit_filter and decn.function.instrumented_file.name != unit_filter:
                continue
            new_data.append(decn)
        return new_data


def entry_exit_decorator(func):
    """
    Used to hook around prepare_data to set/reset data
    """

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        # First argument is self
        self = args[0]

        # Track current MCDC data (we need to reset this later)
        orig_mcdc_decisions = InstrumentedFunction.mcdc_decisions

        # Create our 'patched' decisions
        InstrumentedFunction.mcdc_decisions = PatchMcdcDecisions(
            self.api, orig_mcdc_decisions
        )

        # Run the original code
        result = func(*args, **kwargs)

        # Reset our patched decisions
        InstrumentedFunction.mcdc_decisions = orig_mcdc_decisions

        # Return outout of original function
        return result

    return wrapper


class PerLineMcdc(McdcTables):
    @entry_exit_decorator
    def prepare_data(self):
        try:
            # Newer versions (2025+) expose this private hook
            super()._McdcTables__prepare_tu_data()
        except (AttributeError, TypeError):
            # Older versions only have the public method
            super().prepare_data()

        # Expose whether this is a template-instantiation report
        # (no specific unit → included-header with multiple TUs).
        self.section_context["show_subprogram"] = (
            "unit" not in self.api.mcdc_filter
        )


# EOF
