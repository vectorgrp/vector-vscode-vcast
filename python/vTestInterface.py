"""
//////////////////////////////////////////////////////////////////////////
this started life as a duplicate of:  instumentationLib/vTestInterface.py
//////////////////////////////////////////////////////////////////////////
"""

import argparse
from datetime import datetime
import hashlib
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

from vector.apps.DataAPI.unit_test_api import UnitTestApi
from vector.apps.DataAPI.cover_api import CoverApi
from vector.lib.core.system import cd

class InvalidEnviro(Exception):
    pass


class UsageError(Exception):
    pass


def setupArgs():
    """
    Add Command Line Args
    """

    parser = argparse.ArgumentParser(description="VectorCAST Test Explorer Interface")

    modeChoices = ["getEnviroData", "getCoverageData", "executeTest", "results"]
    parser.add_argument(
        "--mode",
        choices=modeChoices,
        required=True,
        help="Test Explorer Mode",
    )

    kindChoices = ["vcast", "codebased"]
    parser.add_argument(
        "--kind",
        choices=kindChoices,
        required=True,
        help="Environment Kind",
    )

    parser.add_argument(
        "--clicast",
        required=True,
        help="Path to clicast to use"
    )

    parser.add_argument(
        "--path",
        required=True,
        help="Path to Environment Directory",
    )

    parser.add_argument("--test", help="Test ID")

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


def generateTestInfo(test):
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

    return testInfo


import inspect


def getTestDataVCAST(enviroPath):

    # dataAPI throws if there is a tool/enviro missmatch
    try:
        api = UnitTestApi(enviroPath)
    except Exception as err:
        print (err)
        raise InvalidEnviro()
    
    testList = list()
    sourceFiles = dict()

    # Do compound tests ...
    compoundList = api.TestCase.filter(is_compound_test=True)
    compoundNode = dict()
    compoundNode["name"] = "Compound Tests"
    compoundNode["tests"] = list()
    for test in compoundList:
        testInfo = generateTestInfo(test)
        compoundNode["tests"].append(testInfo)
    testList.append(compoundNode)

    # Do Init tests ...
    initList = api.TestCase.filter(is_init_test=True)
    initNode = dict()
    initNode["name"] = "Initialization Tests"
    initNode["tests"] = list()
    for test in initList:
        testInfo = generateTestInfo(test)
        initNode["tests"].append(testInfo)
    testList.append(initNode)

    # Now do normal tests
    for unit in api.Unit.all():
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
            if function.vcast_name!="<<INIT>>":
                # Note: the vcast_name has the parameterization only when there is an overload
                functionNode["name"] = function.vcast_name
                functionNode["tests"] = list()
                for test in function.testcases:
                    if test.is_csv_map:
                        pass
                    else:
                        testInfo = generateTestInfo(test)
                        functionNode["tests"].append(testInfo)

                unitNode["functions"].append(functionNode)

        if len (unitNode["functions"])>0:
            testList.append(unitNode)

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
        sys.stdout.write ("=" * 100 + "\n")
        for line in sourceObject.iterate_coverage():
            sys.stdout.write(str(line.line_number).ljust(line_num_width))
            sys.stdout.write(line._cov_line.covered_char() + " | " + line.text + "\n")


def getUnitData(enviroPath, kind):
    """
    This function will return info about the units in an environment
    """
    unitList = list()
    if kind == "vcast":
        try:
            # this can throw an error of the coverDB is too old!
            capi = CoverApi(enviroPath)
        except Exception as err:
            print(err)
            raise UsageError()

        # For testing/debugging
        #printCoverageListing (enviroPath)

        sourceObjects = capi.SourceFile.all()
        for sourceObject in sourceObjects:
            sourcePath = sourceObject.display_path
            covered, uncovered, checksum = getCoverageData(sourceObject)
            unitInfo = dict()
            unitInfo["path"] = sourcePath
            unitInfo["functionList"] = getFunctionData (sourceObject)
            unitInfo["cmcChecksum"] = checksum
            unitInfo["covered"] = covered
            unitInfo["uncovered"] = uncovered
            unitList.append(unitInfo)

    return unitList


def getFunctionData (sourceObject):
    """
    This function will return info about the functions in a source file
    """
    functionList = list()
    for function in sourceObject.functions:
        functionInfo = dict()
        functionInfo["name"] = function.name
        functionInfo["startLine"] = function.start_line
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
            if os.path.exists (sourceObject.path):
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


commandFileName = "commands.cmd"

globalClicastCommand = ""
def runClicastScript(commandFileName):
    """
    The caller should create a correctly formatted clicast script
    and then call this with the name of that script
    """

    # false at the end tells clicast to ignore errors in individual commands
    commandToRun = f"{globalClicastCommand} -lc tools execute {commandFileName} false"
    try:
        rawOutput = subprocess.check_output(
            commandToRun, stderr=subprocess.STDOUT, shell=True
        )
    except subprocess.CalledProcessError as error:
        rawOutput = error.output

    os.remove(commandFileName)
    return rawOutput.decode("utf-8", errors="ignore")


def getStandardArgsFromTestObject(testIDObject):

    returnString = f'-e {testIDObject.enviroName}'
    if testIDObject.unitName != "not-used":
        returnString += f' -u{testIDObject.unitName}'
    returnString += f' -s{testIDObject.functionName}'
    returnString += f' -t{testIDObject.testName}'
    return returnString


def runTestCommand(testIDObject, commandList):
    """
    Commands is a list where the entries are the ascii strings
    that tell the function what to do.  Valid command strings:
        execute -> run test
        results -> generate the test execution report

    Multiple commands can be included in the commandsList

    """

    # We build a clicast command script to run the test and generate the execution report
    with open(commandFileName, "w") as commandFile:
        standardArgs = getStandardArgsFromTestObject(testIDObject)
        if "execute" in commandList:
            commandFile.write(standardArgs + " execute run\n")
        if "results" in commandList:
            commandFile.write(
                standardArgs
                + " report custom actual "
                + testIDObject.reportName
                + ".html\n"
            )
            commandFile.write("option VCAST_CUSTOM_REPORT_FORMAT TEXT\n")
            commandFile.write(
                standardArgs
                + " report custom actual "
                + testIDObject.reportName
                + ".txt\n"
            )
            commandFile.write("option VCAST_CUSTOM_REPORT_FORMAT HTML\n")

    return runClicastScript(commandFileName)


def executeVCtest(enviroPath, testIDObject):

    with cd(os.path.dirname(enviroPath)):
        commands = list()
        commands.append("execute")
        commands.append("results")
        commandOutput = runTestCommand(testIDObject, commands)

        if "TEST RESULT: pass" in commandOutput:
            print("STATUS:passed")
        else:
            print("STATUS:failed")
        print("REPORT:" + testIDObject.reportName + ".txt")

        # Retrieve the expected value x/y and the
        api = UnitTestApi(enviroPath)
        testList = api.TestCase.filter(name=testIDObject.testName)
        if len(testList) > 0:
            print("PASSFAIL:" + getPassFailString(testList[0]))
            print("TIME:" + getTime(testList[0].start_time))

        print(commandOutput)


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


def executeCodeBasedTest(enviroPath, testID):
    """
    testID looks like: EXAMPLE.CBT.mySuite.byPointer
    So we just need to split the mySuite.byPointer part
    off and pass that to the driver.
    """

    with cd(enviroPath):
        nameOfDriver = os.path.basename(enviroPath).lower()

        if shutil.which(nameOfDriver):
            testString = testID.split("|")[1]
            commandToRun = [nameOfDriver, testString]
            try:
                rawOutput = subprocess.check_output(
                    commandToRun, stderr=subprocess.STDOUT, shell=True
                )
                print(rawOutput.decode("utf-8", errors="ignore"))
            except subprocess.CalledProcessError as error:
                rawOutput = error.output

            print("TIME:" + getTime(datetime.now()))
            reportName = os.path.join(enviroPath, testString) + ".vresults"
            processVResults(reportName)
            print("REPORT:" + reportName)
        else:
            print("FATAL")
            print(f"The executable file: '{nameOfDriver}' does not exist")
            print(
                "Ensure that you've added: 'add_subdirectory(unitTests)' to the CMakeLists.txt file\n"
                + "   that builds the file being tested, and that there are not any CMake errors reported."
            )


def getResults(enviroPath, testIDObject):

    with cd(os.path.dirname(enviroPath)):
        commands = list()
        commands.append("results")
        commandOutput = runTestCommand(testIDObject, commands)

        print("REPORT:" + testIDObject.reportName + ".txt")
        print(commandOutput)


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


def main():

    global globalClicastCommand

    argParser = setupArgs()
    args, restOfArgs = argParser.parse_known_args()

    # no need to pass this all around
    globalClicastCommand = args.clicast

    # enviroPath is the full path to the vce file
    enviroPath = os.path.abspath(args.path)

    # See the comment in: executeVPythonScript()
    print ("ACTUAL-DATA")

    if args.mode == "getEnviroData":
        topLevel = dict()
        topLevel["unitData"] = getUnitData(enviroPath, args.kind)
        topLevel["testData"] = getTestDataVCAST(enviroPath)

        json.dump(topLevel, sys.stdout, indent=4)

    elif args.mode == "getCoverageData":
        unitData = getUnitData(enviroPath, args.kind)
        json.dump(unitData, sys.stdout, indent=4)

    elif args.mode == "executeTest":
        if args.kind == "vcast":
            testIDObject = testID(enviroPath, args.test)
            executeVCtest(enviroPath, testIDObject)
        else:
            executeCodeBasedTest(enviroPath, args.test)

    elif args.mode == "results":
        if args.kind == "vcast":
            testIDObject = testID(enviroPath, args.test)
            getResults(enviroPath, testIDObject)

    else:
        print("Unknown mode value: " + args.mode)
        print("Valid modes are: getEnviroData, getCoverageData, executeTest, results")

    # Zero exit code
    return 0


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
        pass
    except Exception:
        traceBackText = traceback.format_exc()
        print(traceBackText)

    sys.exit(returnCode)
