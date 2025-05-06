import functools

from vector.apps.ReportBuilder.sections.mcdc_tables import McdcTables
from vector.apps.DataAPI.coverdb import InstrumentedFunction


class PatchMcdcDecisions:
    def __init__(self, api, orig):
        self.__api = api
        self.__orig = orig

    def __get__(self, instance, owner):
        data = self.__orig.__get__(instance, owner)
        # Filter the data
        new_data = []
        for decn in data:
            if (
                decn.function.instrumented_file.name == self.__api.mcdc_filter["unit"]
                and decn.start_line == self.__api.mcdc_filter["line"]
            ):
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
        print(result)

        # Reset our patched decisions
        InstrumentedFunction.mcdc_decisions = orig_mcdc_decisions

        # Return outout of original function
        return result

    return wrapper


class PerLineMcdc(McdcTables):
    @entry_exit_decorator
    def prepare_data(self):
        # get a handle to the parent class’s methods
        parent = super(PerLineMcdc, self)

        # If the newer private TU‑prep exists, call it…
        if hasattr(parent, "_McdcTables__prepare_tu_data") and callable(
            parent._McdcTables__prepare_tu_data
        ):
            parent._McdcTables__prepare_tu_data()

        # …otherwise fall back to the classic prepare_data
        else:
            parent.prepare_data()


# EOF
