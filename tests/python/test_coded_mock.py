#!/usr/bin/env vpython

#
# NOTE: we cannot use PyTest here as vpython does not ship with it
#

import sys
import os
import pathlib

# Get the path to where our packages are
path_to_packages = pathlib.Path(__file__).parent.parent.parent / "python"
sys.path.insert(0, str(path_to_packages))

import tstUtilities
import dataAPIutilities

from coded_mock_test_data import test_data


def get_proto_only(api, function_object):
    """
    This gets *only* the prototype of our mock from the vmock library -- we don't want any
    leading/trailing new lines, and we want to strip the `{`
    """
    return (
        tstUtilities.generateVMockDefitionForUnitAndFunction(api, function_object)
        .strip()
        .split("\n")[0]
        .strip(" {")
    )


def create_api_with_typemark(typemark_return):
    """
    This creates a "mock" api class that returns a certain value when
    `Type.get_by_typemark` is called
    """

    api = lambda: None
    api.Type = lambda: None
    api.Type.get_by_typemark = lambda x: typemark_return

    return api


def main():
    for test in test_data:
        function_object = test["Function"]
        api = create_api_with_typemark(test["IsMethod"])

        os.environ[tstUtilities.ENV_VCAST_TEST_EXPLORER_USE_MANGLED_NAMES] = "1"
        actual_mangled_mock_proto = get_proto_only(api, function_object)
        del os.environ[tstUtilities.ENV_VCAST_TEST_EXPLORER_USE_MANGLED_NAMES]
        actual_not_mangled_mock_proto = get_proto_only(api, function_object)

        actual_name_for_addr = dataAPIutilities.getFunctionNameForAddress(
            api, function_object
        )

        expected_mangled_mock_proto = test["Expected"]["MockProtoMangled"]
        expected_not_mangled_mock_proto = test["Expected"]["MockProtoNotMangled"]
        expected_name_for_addr = test["Expected"]["NameForAddr"]

        assert (
            actual_mangled_mock_proto == expected_mangled_mock_proto
        ), f'"{actual_mangled_mock_proto}" != "{expected_mangled_mock_proto}"'
        assert (
            actual_not_mangled_mock_proto == expected_not_mangled_mock_proto
        ), f"{actual_not_mangled_mock_proto} != {expected_not_mangled_mock_proto}"
        assert (
            actual_name_for_addr == expected_name_for_addr
        ), f"{actual_name_for_addr} != {expected_name_for_addr}"


if __name__ == "__main__":
    main()

# EOF
