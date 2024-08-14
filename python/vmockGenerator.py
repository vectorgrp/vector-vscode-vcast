# A skeleton for the generating all vmock definitions for an environment

import os
import subprocess
import sys
import traceback

from string import Template


from dataAPIutilities import functionCanBeMocked

import tstUtilities
from tstUtilities import (
    generateMockDataForFunction,
    generateMockForFunction,
)

from vector.apps.DataAPI.unit_test_api import UnitTestApi


trace_enabled = True


def trace(message):
    if trace_enabled:
        print(message)


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
        trace(f"Processing unit: {unitObject.name}")
        for functionObject in unitObject.functions:
            # We don't want to handle `<<INIT>>` subprograms (bug in VectorCAST)
            if not functionCanBeMocked(functionObject):
                continue

            if first_unit is None:
                # We record the first unit _with functions_
                first_unit = unitObject.name

            # Extract what we need
            #
            # Note: we're doing this with string processing here to avoid
            # changing too much of the actual code
            trace(f"  function: {functionObject.name}")

            # First generate the mock data
            mock_data = generateMockDataForFunction(api, functionObject)
            # then generate the mock definition that we will return
            mock_definition = generateMockForFunction(mock_data)

            # Save all the data we need
            # Add a comment to the start of the declaration, so it looks the same
            # as if the user used the intellisense auto-complete to create the mock
            mock_comment = f"// vmock {unitObject.name} {functionObject.vcast_name}"
            mock_definition = mock_comment + mock_definition
            mock_bodies.append(f"{mock_definition}")
            mock_usages.append(mock_data.enableFunctionCall)

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


# filenames are hard-coded for now, tests.cpp and tests.tst
basename = "tests"
test_file = f"{basename}.cpp"
script_file = f"{basename}.tst"


def generate_test_file(enviro_path, prepend=None):
    """
    Generates an instantiated C++ test file and its associated test script.

    "prepend" allows the caller to pass in some extra text to insert at the
    start of the file
    """

    if prepend is None:
        prepend = []

    env_name = os.path.basename(enviro_path)

    # Use DataAPI + the extension code to generate all of the bodies we want to write-out
    first_unit, mock_bodies, mock_usages = generateAllVMockDefinitions(enviro_path)

    # Generate the C++ file
    with open(test_file, "w") as test_cpp_file:
        test_cpp_file.write("\n".join(prepend) + "\n")
        test_cpp_file.write(
            TEST_CPP_TEMPLATE.safe_substitute(
                mock_bodies="\n".join(mock_bodies),
                env_name=env_name.title(),
                mock_usages="\n    ".join(mock_usages),
            )
        )

    return first_unit


def generate_test_script(env_name, first_unit):
    with open(script_file, "w") as test_tst_file:
        test_tst_file.write(
            TEST_TST_TEMPLATE.safe_substitute(
                cpp_unit_name=basename, first_unit=first_unit
            )
        )

    # Tell the user how to load it
    print(
        f"$VECTORCAST_DIR/clicast -e {env_name} test script run {script_file} && $VECTORCAST_DIR/clicast -e {env_name} execute batch"
    )


def generate_tests_for_environment(env_name):
    """
    Use Case:  vpython vmockGenerator.py <path-to-enviro-directory>

    In this mode we will generate a tests.cpp for the environment
    that was passed to us as an argument
    """

    # Generate our coded test ...
    first_unit = generate_test_file(env_name)
    # ... and the test script to load the coded test
    generate_test_script(env_name, first_unit)


error_file = f"{test_file}.errors.txt"


def save_errors_to_file(errors):
    with open(error_file, "w") as f:
        for error in errors:
            f.write(f"{error}\n")


def compile_file(command):
    try:
        stdout = subprocess.check_output(command, shell=True, stderr=subprocess.STDOUT)
        exit_code = 0
    except subprocess.CalledProcessError as error:
        stdout = error.output
        exit_code = error.returncode

    return exit_code, stdout


def get_list_of_directories_to_process():
    """
    When we get here we are in batch mode, and now the question is whether
    to walk the directory tree looking for directories with a master.db and unit.cpp file
    or to use a list of directories that we have been given.
    """

    what_to_return = []

    if len(sys.argv) == 3:
        if os.path.isfile(sys.argv[2]):
            with open(sys.argv[2], "r") as f:
                for line in f:
                    line = line.strip()
                    if os.path.exists(line):
                        what_to_return.append(line)
                    else:
                        print(f"Directory {line} does not exist")
        else:
            print(
                "The third argument should be a file with a list of directories to process"
            )

    else:
        print("Looking for directories with a master.db and unit.cpp file ...")
        for root, _, files in os.walk("."):
            if "master.db" in files and "unit.cpp" in files:
                what_to_return.append(root)

        print(f"Found {len(what_to_return)} directories to process")

    return what_to_return


def generate_tests_and_compile():
    """
    Use Case: vpython vmockGenerator.py batch

    In this mode we will search for all directories that contain a master.db and unit.cpp file.
    For each directory we will generate a tests.cpp file insert a #include "unit.cpp" at the top
    and then try to compile it with g++ ... keeping track of the files that work and the ones
    that do not in $CWD/worked.txt, $CWD/failed.txt
    """

    # disable trace in batch mode
    global trace_enabled
    trace_enabled = False

    # Find all the directories with a master.db and unit.cpp file
    enviroDirs = get_list_of_directories_to_process()

    unit_file_does_not_compile = []
    tests_compile = []
    tests_do_not_compile = []

    for enviro_path in enviroDirs:
        enviro_path = os.path.abspath(enviro_path)

        print(f"Processing: {enviro_path}")
        try:
            # cd to the enviro directory
            cwd = os.getcwd()
            os.chdir(enviro_path)

            # first try to compile the unit.cpp file using g++
            print("  compiling unit.cpp ...")
            compile_command = "g++ -std=c++14 -c -w unit.cpp"
            exit_code, stdout = compile_file(compile_command)

            if exit_code != 0:
                print("  unit.cpp does not compile")
                unit_file_does_not_compile.append(enviro_path)

            else:
                # generate the tests.cpp
                print("  generating tests ...")
                generate_test_file(enviro_path, prepend=['#include "unit.cpp"'])

                # now try to compile it
                # compile the tests.cpp file using g++
                vcast_dir = os.environ.get("VECTORCAST_DIR", "C:/vcast/")
                include_path = os.path.join(vcast_dir, "vunit/include")
                compile_command = f"g++ -std=c++14 -I{include_path} -c -w tests.cpp"

                print("  compiling tests file ...")
                exit_code, stdout = compile_file(compile_command)

                if exit_code == 0:
                    tests_compile.append(enviro_path)
                else:
                    save_errors_to_file(stdout.decode("utf-8").split("\n"))
                    tests_do_not_compile.append(enviro_path)

                print(f"  command: {compile_command} returned: {exit_code}")

            # return to original cwd
            os.chdir(cwd)

        except Exception:
            print(f"Failed to process: {enviro_path}")
            print(traceback.format_exc())

    print("\nSummary:")
    print(f"  Total directories processed: {len(enviroDirs)}")
    print(f"  Test files compiled successfully: {len(tests_compile)}")
    if len(tests_do_not_compile) > 0:
        print(f"  Test files that did not compile: {len(tests_do_not_compile)}")
    if len(unit_file_does_not_compile) > 0:
        print(f"  Unit files that did not compile: {len(unit_file_does_not_compile)}")

    summary_file = "summary.txt"
    print(f"\nSave details into {summary_file}")
    with open(summary_file, "w") as f:
        f.write(f"Total directories processed: {len(enviroDirs)}\n")
        f.write(f"\nTest files compiled successfully: {len(tests_compile)}\n")
        for enviro_path in tests_compile:
            f.write(f"  {enviro_path}\n")
        f.write(f"\nTest files that did not compile: {len(tests_do_not_compile)}\n")
        for enviro_path in tests_do_not_compile:
            f.write(f"  {enviro_path}\n")
        f.write(
            f"\nUnit files that did not compile: {len(unit_file_does_not_compile)}\n"
        )
        for enviro_path in unit_file_does_not_compile:
            f.write(f"  {enviro_path}\n")


def main():
    """
    This can be used in two modes
        - Pass the path to an environment directory
        -
    """

    tstUtilities.addHashToMockFunctionNames = True

    if (
        len(sys.argv) == 2
        and (env_name := sys.argv[1])
        and os.path.exists(os.path.join(env_name, "master.db"))
    ):
        generate_tests_for_environment(env_name)

    elif len(sys.argv) >= 2 and sys.argv[1] == "batch":
        generate_tests_and_compile()

    else:
        print("Usage: vpython vmockGenerator.py <path-to-enviro-directory> | batch")


if __name__ == "__main__":
    main()

# EOF
