# A skeleton for the generating all vmock definitions for an environment

import sys
from tstUtilities import generateVMockDefitionForUnitAndFunction

from vector.apps.DataAPI.unit_test_api import UnitTestApi


def generateAllVMockDefinitions(enviroPath):
    """
    This functtion is used for bulk testing of the vmock generation logic
    It takes the full path to an environment and generates all the vmock
    definitions for all the functions in all the units in the environment
    """

    api = UnitTestApi(enviroPath)
    for unitObject in api.Unit.all():
        for functionObject in unitObject.functions:

            # TBD: do some "per mock stuff"
            print(generateVMockDefitionForUnitAndFunction(unitObject, functionObject))


def main():
    if len(sys.argv) == 2:
        generateAllVMockDefinitions(sys.argv[1])
    else:
        print("Pass enviro path as an argument")


if __name__ == "__main__":
    main()
