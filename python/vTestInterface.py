"""
//////////////////////////////////////////////////////////////////////////
this started life as a duplicate of:  instumentationLib/vTestInterface.py
//////////////////////////////////////////////////////////////////////////
"""

import argparse
from datetime import datetime
import hashlib
import inspect
import json
import os
import subprocess
import re
import shutil
import site
import sys
import traceback

"""
///////////////////////////////////////////////////////////////////////////////////////////
This script must be run under vpython
///////////////////////////////////////////////////////////////////////////////////////////
"""

import clicastInterface

from vector.apps.DataAPI.unit_test_api import UnitTestApi
from vector.apps.DataAPI.cover_api import CoverApi
from vector.lib.core.system import cd

vpythonHasCodedTestSupport: bool = False
try:
    from vector.lib.coded_tests import Parser

    vpythonHasCodedTestSupport = True
except:
    pass


class InvalidEnviro(Exception):
    pass


class UsageError(Exception):
    pass


modeChoices = [
    "getEnviroData",
    "executeTest",
    "executeTestReport",
    "report",
    "parseCBT",
    "rebuild",
]


def setupArgs():
    """
    Add Command Line Args
    """

    parser = argparse.ArgumentParser(description="VectorCAST Test Explorer Interface")

    parser.add_argument(
        "--mode",
        choices=modeChoices,
        required=True,
        help="Test Explorer Mode",
    )

    parser.add_argument("--clicast", help="Path to clicast to use")

    parser.add_argument(
        "--path",
        help="Path to Environment Directory",
    )

    parser.add_argument("--test", help="Test ID")

    parser.add_argument(
        "--options", help="Serialized JSON object containing other option values"
    )

    return parser


def textStatus(status):
    # convert from the vcast format to what we need
    textStatus = ""
    if status == "TC_EXECUTION_PASSED":
        textStatus = "passed"
    elif status == "TC_EXECUTION_FAILED":
        textStatus = "failed"
    return textStatus


def getTime(time):
    # convert from datetime to human readable
    # if the time is today only return the time part not the date part
    if time:
        timeString = time.ctime()

        today = datetime.now()
        if (
            today.year == time.year
            and today.month == time.month
            and today.day == time.day
        ):
            return timeString.split()[3]
        else:
            return timeString
    else:
        return ""


def XofYString(numerator, denominator):
    if numerator == 0 or denominator == 0:
        return ""
    else:
        percentageString = "{:.2f}".format((numerator * 100) / denominator)
        return str(numerator) + "/" + str(denominator) + " (" + percentageString + ")"


def getPassFailString(test):
    """
    This function takes a dataAPI testObject and
    returns the pass/fail string
    """

    summary = test.summary
    denominator = summary.expected_total + summary.control_flow_total

    numerator = denominator - (summary.expected_fail + summary.control_flow_fail)
    return XofYString(numerator, denominator)


def generateTestInfo(enviroPath, test):
    """
    This function takes a test object from the dataAPI
    and creates a dictionary with the attributes we need
    """
    testInfo = dict()
    testInfo["testName"] = test.name

    testInfo["notes"] = test.notes
    # stored as 0 or 1
    testInfo["compoundOnly"] = test.for_compound_only
    testInfo["time"] = getTime(test.start_time)
    testInfo["status"] = textStatus(test.status)
    testInfo["passfail"] = getPassFailString(test)

    # New to support coded tests in vc24
    if vpythonHasCodedTestSupport and test.coded_tests_file:
        # guard against the case where the coded test file has been renamed or deleted
        # or dataAPI has a bad line nuumber for the test, and return None in this case.
        enclosingDirectory = os.path.dirname (enviroPath)
        codedTestFilePath = os.path.abspath (os.path.join(enclosingDirectory, test.coded_tests_file))
        if os.path.exists(codedTestFilePath) and test.coded_tests_line > 0:
            testInfo["codedTestFile"] = codedTestFilePath
            testInfo["codedTestLine"] = test.coded_tests_line
        else:
            testInfo = None

    return testInfo


# This list is created as we walk the dataAPI list of units->functions
# in getTestDataVCAST(), and we use it to set the isTestable field when
# walk the coverage data in the getUnitData() function which has no
# knowledge of "testabilty"
globalListOfTestableFunctions = []


def getTestDataVCAST(enviroPath):

    global globalListOfTestableFunctions

    # dataAPI throws if there is a tool/enviro mismatch
    try:
        api = UnitTestApi(enviroPath)
    except Exception as err:
        print(err)
        raise InvalidEnviro()

    # Not currently used.
    # returns "None" if coverage is not initialized,
    # does not change based on coverage enabled/disabled
    coverageType = api.environment.coverage_type_text

    testList = list()
    sourceFiles = dict()

    # Do compound tests ...
    compoundList = api.TestCase.filter(is_compound_test=True)
    compoundNode = dict()
    compoundNode["name"] = "Compound Tests"
    compoundNode["tests"] = list()
    for test in compoundList:
        testInfo = generateTestInfo(enviroPath, test)
        compoundNode["tests"].append(testInfo)
    testList.append(compoundNode)

    # Do Init tests ...
    initList = api.TestCase.filter(is_init_test=True)
    initNode = dict()
    initNode["name"] = "Initialization Tests"
    initNode["tests"] = list()
    for test in initList:
        testInfo = generateTestInfo(enviroPath, test)
        initNode["tests"].append(testInfo)
    testList.append(initNode)

    # Now do normal tests
    for unit in api.Unit.all():
        # we used to add these and throw them away in the typescript, nowe we don't add them
        if unit.name != "uut_prototype_stubs":
            unitNode = dict()
            unitNode["name"] = unit.name
            try:
                unitNode["path"] = unit.path
            except:
                pass
            unitNode["functions"] = list()
            for function in unit.functions:
                functionNode = dict()
                # Seems like a vcast dataAPI bug with manager.cpp
                if (
                    function.vcast_name != "<<INIT>>"
                    and not function.is_non_testable_stub
                ):
                    # Note: the vcast_name has the parameterization only when there is an overload
                    functionNode["name"] = function.vcast_name
                    functionNode["parameterizedName"] = function.long_name
                    globalListOfTestableFunctions.append(function.long_name)
                    functionNode["tests"] = list()
                    for test in function.testcases:
                        if test.is_csv_map:
                            pass
                        else:
                            # A coded test file might have been renamed or deleted,
                            # in which case generateTestInfo() will return None
                            testInfo = generateTestInfo(enviroPath, test)
                            if testInfo:
                                functionNode["tests"].append(testInfo)

                    unitNode["functions"].append(functionNode)

            if len(unitNode["functions"]) > 0:
                testList.append(unitNode)

    api.close()
    return testList


def printCoverageListing(enviroPath):
    """
    This is used for testing only ...
    It will print out the coverage for each file in the environment.

    The caller will ensure that the source file is part of the environment
    The covered_char is used as follows:
        " " UNCOVERED
        "*" COVERED
        "A" ANNOTATED
        "P" PARTIAL
        "a" ANNOTATED_PARTIAL
        "X" NOT_APPLICABLE
    """
    splitter = "-" * 80
    line_num_width = 6

    capi = CoverApi(enviroPath)

    sourceObjects = capi.SourceFile.all()
    for sourceObject in sourceObjects:
        sys.stdout.write("=" * 100 + "\n")
        for line in sourceObject.iterate_coverage():
            sys.stdout.write(str(line.line_number).ljust(line_num_width))
            sys.stdout.write(line._cov_line.covered_char() + " | " + line.text + "\n")
    capi.close()


def getUnitData(enviroPath):
    """
    This function will return info about the units in an environment
    """
    unitList = list()
    try:
        # this can throw an error of the coverDB is too old!
        capi = CoverApi(enviroPath)
    except Exception as err:
        print(err)
        raise UsageError()

    # For testing/debugging
    # printCoverageListing (enviroPath)

    sourceObjects = capi.SourceFile.all()
    for sourceObject in sourceObjects:
        sourcePath = sourceObject.display_path
        covered, uncovered, checksum = getCoverageData(sourceObject)
        unitInfo = dict()
        unitInfo["path"] = sourcePath
        unitInfo["functionList"] = getFunctionData(sourceObject)
        unitInfo["cmcChecksum"] = checksum
        unitInfo["covered"] = covered
        unitInfo["uncovered"] = uncovered
        unitList.append(unitInfo)

    capi.close()
    return unitList


def getFunctionData(sourceObject):
    """
    This function will return info about the functions in a source file
    """
    functionList = list()
    for function in sourceObject.functions:
        functionInfo = dict()
        functionInfo["name"] = function.name
        functionInfo["startLine"] = function.start_line
        functionInfo["isTestable"] = function.name in globalListOfTestableFunctions
        functionList.append(functionInfo)

    return functionList


def getCoverageData(sourceObject):
    """
    This function will use the data interface to
    get the coverage data for a single file
    """
    coveredString = ""
    uncoveredString = ""
    checksum = 0
    if sourceObject:
        checksum = sourceObject.checksum
        if sourceObject.has_cover_data:
            # if iterate_coverage crashes if the original
            # file path does not exist.
            if os.path.exists(sourceObject.path):
                for line in sourceObject.iterate_coverage():
                    covLine = line._cov_line
                    covChar = covLine.covered_char()
                    if covChar in ["*", "A"]:
                        coveredString += str(line.line_number) + ","
                    elif covChar in [" ", "P", "a"]:
                        uncoveredString += str(line.line_number) + ","

                # print, but drop the last colon
                coveredString = coveredString[:-1]
                uncoveredString = uncoveredString[:-1]

    return coveredString, uncoveredString, checksum


def executeVCtest(enviroPath, testIDObject, generateReport):
    with cd(os.path.dirname(enviroPath)):
        returnText = ""

        returnCode, commandOutput = clicastInterface.executeTest(testIDObject)
        if generateReport:
            commandOutput += clicastInterface.generateExecutionReport(testIDObject)

        if "TEST RESULT: pass" in commandOutput:
            returnText += "STATUS:passed\n"
        else:
            returnText += "STATUS:failed\n"
        returnText += f"REPORT:{testIDObject.reportName}.txt\n"

        # Retrieve the expected value x/y and the
        api = UnitTestApi(enviroPath)
        testList = api.TestCase.filter(name=testIDObject.testName)
        if len(testList) > 0:
            returnText += f"PASSFAIL:" + getPassFailString(testList[0])
            returnText += f"TIME:{getTime(testList[0].start_time)}\n"
        api.close()

        returnText += commandOutput
        return returnCode, returnText


def processVResults(filePath):
    if os.path.isfile(filePath):
        with open(filePath, "r") as file:
            lineList = file.readlines()
            passCount = 0
            failCount = 0
            for line in lineList:
                if line.startswith("PASS"):
                    passCount += 1
                elif line.startswith("FAIL"):
                    failCount += 1
            print(f"PASSFAIL:{XofYString (passCount, passCount+failCount)}")

            if failCount == 0:
                print("STATUS:passed")
            else:
                print("STATUS:failed")
    else:
        print(f"{filePath} not found")


def getResults(enviroPath, testIDObject):
    with cd(os.path.dirname(enviroPath)):
        commands = list()
        commands.append("report")
        commandOutput = clicastInterface.generateExecutionReport (testIDObject)

        returnText = f"REPORT:{testIDObject.reportName}.txt\n"
        returnText += commandOutput
        return returnText


def getCodeBasedTestNames(filePath):
    """
    This function will use the same file parser that the vcast
    uses to extract the test names from the CBT file.  It will return
    a list of dictionaries that contain the test name, the file path
    and the starting line for he test
    """

    returnObject = None
    if os.path.isfile(filePath):

        cbtParser = Parser()
        with open(filePath, "r") as cbtFile:
            fileData = cbtParser.parse(filePath)
            outputList = []
            for test in fileData:
                outputNode = {
                    "testName": f"{test.test_suite}.{test.test_case}",
                    "codedTestFile": filePath,
                    "codedTestLine": test.line,
                }
                outputList.append(outputNode)
            returnObject = {"tests": outputList}
    return returnObject


class testID:
    def __init__(self, enviroPath, testIDString):
        self.enviroName, restOfString = testIDString.split("|")
        pieces = restOfString.split(".")
        self.unitName = pieces[0]
        self.functionName = pieces[1]
        self.testName = ".".join(pieces[2:])

        # There can be all sort of odd characters in the test name
        # because we use the parameterized name ... so create a hash
        temp = ".".join([self.unitName, self.functionName, self.testName])
        hashString = hashlib.md5(temp.encode("utf-8")).hexdigest()
        self.reportName = os.path.join(enviroPath, hashString)


def validateClicastCommand(command, mode):
    """
    The --clicast arg is only required for a sub-set of modes, so we do
    those checks here, and throw usage error if there is a probelem
    """
    if mode.startswith("executeTest") or mode == "rebuild":
        if command is None or len(command) == 0:
            print(f"Arg --clicast is required for mode: {mode}")
            raise UsageError()
        elif os.path.isfile(command) or (
            sys.platform == "win32" and os.path.isfile(command + ".exe")
        ):
            pass
        else:
            print(f"Invalid value for --clicast: {command}")
            raise UsageError()


def processOptions(optionString):
    """
    This function will take the options string and return a dictionary
    """
    returnObject = None
    if optionString and len(optionString) > 0:
        try:
            returnObject = {}
            returnObject = json.loads(optionString)
        except:
            print("Invalid --options argument, value not JSON formatted")
            raise UsageError()
    return returnObject


def processCommand(mode, clicast, pathToUse, testString="", options="") -> dict:
    """
    This function does the actual work of processing a vTestInterface command,
    it will return a dictionary with the results of the command
    """

    returnCode = 0
    returnObject = None

    # no need to pass this all around
    validateClicastCommand(clicast, mode)
    clicastInterface.globalClicastCommand = clicast

    if mode == "getEnviroData":
        topLevel = dict()
        # it is important that getTetDataVCAST() is called first since it sets up
        # the global list of tesable functoions that getUnitData() needs
        topLevel["testData"] = getTestDataVCAST(pathToUse)
        topLevel["unitData"] = getUnitData(pathToUse)
        returnObject = topLevel

    elif mode.startswith("executeTest"):
        try:
            testIDObject = testID(pathToUse, testString)
        except:
            print("Invalid test ID, provide a valid --test argument")
            raise UsageError()
        returnCode, returnText = executeVCtest(
            pathToUse, testIDObject, mode == "executeTestReport"
        )
        returnObject = {"text": returnText.split("\n")}

    elif mode == "report":
        try:
            testIDObject = testID(pathToUse, testString)
        except:
            print("Invalid test ID, provide a valid --test argument")
            raise UsageError()
        returnObject = {"text": getResults(pathToUse, testIDObject).split("\n")}

    elif mode == "parseCBT":
        # This is a special mode used by the unit test driver to parse the CBT
        # file and generate the test list.
        returnObject = getCodeBasedTestNames(pathToUse)

    elif mode == "rebuild":
        # Rebuild environment has some special processing because we want
        # to incorporate any changed build settings, like coverageKind

        # we don't set the return object for rebuild, because we echo in real-time
        jsonOptions = processOptions(options)
        clicastInterface.rebuildEnvironment(pathToUse, jsonOptions)

    # only used for executeTest currently
    return returnCode, returnObject


def main():

    argParser = setupArgs()
    args, restOfArgs = argParser.parse_known_args()

    # path is the path to the enviro directory or cbt file
    pathToUse = os.path.abspath(args.path)

    # See the comment in: executeVPythonScript()
    print("ACTUAL-DATA")

    returnCode, returnObject = processCommand(
        args.mode, args.clicast, pathToUse, args.test, args.options
    )
    if returnObject:
        if "text" in returnObject:
            returnText = "\n".join(returnObject["text"])
            print(returnText)
        else:
            returnText = json.dumps(returnObject, indent=4)
            print(returnText)

    # only used for executeTest currently
    return returnCode


if __name__ == "__main__":
    # Exit with 1 by default
    returnCode = 1

    try:
        returnCode = main()
    except InvalidEnviro:
        # We treat invalid enviro as a warning
        returnCode = 99
    except UsageError:
        # for usage error we print the issue where we see it
        returnCode = 1
    except Exception:
        traceBackText = traceback.format_exc()
        print(traceBackText)
        returnCode = 1

    sys.exit(returnCode)
