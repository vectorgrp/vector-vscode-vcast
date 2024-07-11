from collections import namedtuple

MockFunction = namedtuple(
    "MockFunction",
    [
        "name",
        "parameters",
        "unit",
        "vcast_name",
        "prototype_instantiation",
        "is_overloaded",
        "parameterization",
        "original_return_type",
        "mock_lookup_type",
        "full_prototype_instantiation",
        "mangled_name",
    ],
)

MockUnit = namedtuple("MockUnit", ["name"])

MockParameter = namedtuple("MockParameter", ["name", "orig_declaration"])

# EOF
