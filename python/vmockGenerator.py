# A skeleton for the generating all vmock definitions for an environment

import sys
import os
import traceback

from string import Template

from tstUtilities import generateVMockDefinitionForUnitAndFunction, getFunctionList
from vector.apps.DataAPI.unit_test_api import UnitTestApi


def generateAllVMockDefinitions(enviroPath):
    """
    This function is used for bulk testing of the vmock generation logic
    It takes the full path to an environment and generates all the vmock
    definitions for all the functions in all the units in the environment.

    It returns:

        * The name of the first unit with functions

        * A list of 'mock bodies'

        * A list of 'mock usages'
    """

    # The name of the first unit with subprograms
    first_unit = None

    # The list of all mock bodies
    mock_bodies = []

    # The list of all mock usages
    mock_usages = []

    api = UnitTestApi(enviroPath)
    for unitObject in api.Unit.all():
        # This means we only try to generate on functions that we accept are 'workable'
        for functionObject in getFunctionList(api, unitObject.name, returnObjects=True):
            if first_unit is None:
                # We record the first unit _with functions_
                first_unit = unitObject.name

            # Extract what we need
            #
            # Note: we're doing this with string processing here to avoid
            # changing too much of the actual code
            try:
                mock_content = generateVMockDefinitionForUnitAndFunction(
                    unitObject, functionObject
                )
            except IndexError as exc:
                # We have at least one know, crash, so let's see if we can find
                # others
                #
                # This code means we "accept" the one, known crash
                tb = traceback.format_tb(exc.__traceback__)
                last_code_line = tb[-1].strip().split("\n")[-1].strip()
                if last_code_line == "typeString = parameterTypeList[paramIndex]":
                    continue

                # If it isn't the above, let's raise
                raise

            # The vmock usage line
            invocation = None

            # Iterate on all parts of the mock content to find the usage
            for line in mock_content.split("\n"):
                # Remove whitespace
                line = line.strip()

                # When we've found the usage line
                if line.startswith("// Usage: "):
                    # Grab the invocation
                    invocation = line[len("// Usage: ") :]

                    # It should now be the vmock_session content
                    assert invocation.startswith("vmock_session.")

                    # We're done
                    break

            # If we haven't parsed the invocation line, we have an issue
            assert invocation is not None

            # Save all the data we need
            mock_bodies.append(mock_content)
            mock_usages.append(invocation)

    # Don't run this on a file with no units
    assert first_unit is not None

    return first_unit, mock_bodies, mock_usages


# Our template for a C++ test file
TEST_CPP_TEMPLATE = Template(
    """
#include <vunit/vunit.h>
${mock_bodies}
VTEST(${env_name}, ${env_name}TestCase)
{
    auto vmock_session = ::vunit::MockSession();
    ${mock_usages}
}
""".lstrip()
)

# Our template for a VectorCAST test script
TEST_TST_TEMPLATE = Template(
    """
-- Test Case: ${cpp_unit_name}
TEST.UNIT: ${first_unit}
TEST.SUBPROGRAM:coded_tests_driver
TEST.NEW
TEST.NAME: ${cpp_unit_name}
TEST.CODED_TESTS_FILE: ${cpp_unit_name}.cpp
TEST.END
""".lstrip()
)


def generate_test(env_name, first_unit, mock_bodies, mock_usages):
    """
    Generates an instantiated C++ test file and its associated test script
    """

    # How we're going to name our output files
    cpp_unit_name = "tests"
    cpp_name = f"{cpp_unit_name}.cpp"
    tst_name = f"{cpp_unit_name}.tst"

    # Generate the C++ file
    with open(cpp_name, "w") as test_cpp_file:
        test_cpp_file.write(
            TEST_CPP_TEMPLATE.safe_substitute(
                mock_bodies="\n".join(mock_bodies),
                env_name=env_name.title(),
                mock_usages="\n    ".join(mock_usages),
            )
        )

    # Generate the .tst file
    with open(tst_name, "w") as test_tst_file:
        test_tst_file.write(
            TEST_TST_TEMPLATE.safe_substitute(
                cpp_unit_name=cpp_unit_name, first_unit=first_unit
            )
        )

    # Tell the user how to load it
    print(
        f"$VECTORCAST_DIR/clicast -e {env_name} test script run {tst_name} && $VECTORCAST_DIR/clicast -e {env_name} execute batch"
    )


def main():
    # Condition to only run this on a build environment
    if (
        len(sys.argv) == 2
        and (env_name := sys.argv[1])
        and os.path.exists(os.path.join(env_name, "master.db"))
    ):
        # Use DataAPI + the extension code to generate all of the bodies we want to write-out
        first_unit, mock_bodies, mock_usages = generateAllVMockDefinitions(env_name)

        # Generate our coded test + the test script to load the coded test
        generate_test(env_name, first_unit, mock_bodies, mock_usages)

    else:
        print("Pass enviro path as an argument")


if __name__ == "__main__":
    main()

# EOF
