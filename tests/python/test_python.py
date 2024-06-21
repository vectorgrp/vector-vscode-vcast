#!/usr/bin/env vpython

#
# NOTE: we cannot use PyTest here as vpython does not ship with it
#

import sys
import os
import pathlib
from collections import namedtuple

# Get the path to where our packages are
path_to_packages = pathlib.Path(__file__).parent.parent.parent / "python"
sys.path.insert(0, str(path_to_packages))

import tstUtilities

MockUnitObject = namedtuple("MockUnitObject", "name")

MockFunctionObject = namedtuple(
    "MockFunctionObject", "parameterization mangled_name name unit"
)


def check_values(func, parameterization, mangled_name, name, expected):
    mockFunctionObject = MockFunctionObject(
        parameterization, mangled_name, name, unit=MockUnitObject("test")
    )
    actual = func(mockFunctionObject)
    assert actual == expected, f"{actual} != {expected}"


def test_getReturnType():
    to_check = [
        # Function that takes three ints, returns an int
        ("(int,int,int)int", "int"),
        # Function that takes a void(*)(int,int) fp and returns a
        # void(*)(int,int) fp
        ("(void (*)(int, int))void (*)(int, int)", "void (*)(int, int)"),
        # Function that takes a template + and int and returns a template
        # containing a void(*)(void) fp
        ("(array<int, 1>,int)array<void (*)(void), 1>", "array<void (*)(void), 1>"),
        # Const function returning const vector
        (
            "()const std::vector<int, std::allocator<int>>const",
            "const std::vector<int, std::allocator<int>>",
        ),
        # Const function returning const int
        ("()const int const", "const int"),
    ]

    # These tests don't need a mangled name
    mangled_name = None
    name = None

    for parameterization, expected in to_check:
        check_values(
            tstUtilities.getReturnType, parameterization, mangled_name, name, expected
        )


def test_getParameterTypesFromParameterization():
    to_check = [
        # Function that takes three ints
        ("(int,int,int)", ["int", "int", "int"]),
        # Function that takes two ints, and two void(*)(int, int) fps
        (
            "(int,int,void (*)(int, int),void (*)(int, int))",
            ["int", "int", "void (*)(int, int)", "void (*)(int, int)"],
        ),
        # Function that takes an template and int
        ("(std::array<int, 1UL>,int)", ["std::array<int, 1UL>", "int"]),
    ]

    # These tests don't need a mangled name
    mangled_name = None
    name = None

    for parameterization, expected in to_check:
        check_values(
            tstUtilities.getParameterTypesFromParameterization,
            parameterization,
            mangled_name,
            name,
            expected,
        )


def test_getFunctionName():
    to_check = [
        # We want to use the mangled name for operators to make sure the functions are unique
        ("Moo<int>::operator==", "_ZN3MooIiEeqEi", "vmock_test__ZN3MooIiEeqEi"),
        # Make sure we drop template params (we don't care about the mangled name in this case)
        ("Moo<int>::foo", "", "vmock_test_Moo_foo"),
    ]

    # These tests don't need parameterization
    parameterization = None

    for name, mangled_name, expected in to_check:
        check_values(
            tstUtilities.getFunctionName,
            parameterization,
            mangled_name,
            name,
            expected,
        )


def main():
    test_getReturnType()
    test_getParameterTypesFromParameterization()
    test_getFunctionName()


if __name__ == "__main__":
    main()

# EOF
