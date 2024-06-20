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

MockFunctionObject = namedtuple("MockFunctionObject", "parameterization")


def check_values(func, parameterization, expected):
    mockFunctionObject = MockFunctionObject(parameterization)
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
    ]

    for parameterization, expected in to_check:
        check_values(tstUtilities.getReturnType, parameterization, expected)


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

    for parameterization, expected in to_check:
        check_values(
            tstUtilities.getParameterTypesFromParameterization,
            parameterization,
            expected,
        )


def main():
    test_getReturnType()
    test_getParameterTypesFromParameterization()


if __name__ == "__main__":
    main()

# EOF
