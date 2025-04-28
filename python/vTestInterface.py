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
import sys
import traceback

"""
///////////////////////////////////////////////////////////////////////////////////////////
This script must be run under vpython
///////////////////////////////////////////////////////////////////////////////////////////
"""

import coverageGutter
import clicastInterface
import pythonUtilities
import tstUtilities
import mcdcReport

from vcastDataServerTypes import errorCodes
from vConstants import TAG_FOR_INIT
from versionChecks import (
    vpythonHasCodedTestSupport,
    enviroSupportsMocking,
)
from pythonUtilities import logMessage

from vector.apps.DataAPI.manage_api import VCProjectApi
from vector.apps.DataAPI.vcproject_models import EnvironmentType
from vector.apps.DataAPI.unit_test_api import UnitTestApi
from vector.lib.core.system import cd
from vector.enums import COVERAGE_TYPE_TYPE_T

if vpythonHasCodedTestSupport():
    from vector.lib.coded_tests import Parser


class InvalidEnviro(Exception):
    pass


class UsageError(Exception):
    pass


modeChoices = [
    "getProjectData",
    "getEnviroData",
    "executeTest",
    "report",
    "mcdcReport",
    "mcdcLines",
    "parseCBT",
    "rebuild",
]


def setupArgs():
    """
    Add Command Line Args
    """

    parser = argparse.ArgumentParser(description="VectorCAST Test Explorer Interface")

    # we intentionally do NOT provide a choice list so that we can handle
    # --mode errors manually and control the exit code
    parser.add_argument("--mode", required=True, help="Test Explorer Mode")

    parser.add_argument("--clicast", help="Path to clicast to use")

    parser.add_argument("--path", required=True, help="Path to Environment Directory")

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
    if denominator == 0:
        return ""
    else:
        if numerator == 0:
            percentageString = "0"
        else:
            percentageString = "{:.2f}".format((numerator * 100) / denominator)
        return str(numerator) + "/" + str(denominator) + " (" + percentageString + "%)"


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
    This function takes an enviroPath and a dataAPI test object
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
    if vpythonHasCodedTestSupport() and test.coded_tests_file:
        # guard against the case where the coded test file has been renamed or deleted
        # or dataAPI has a bad line number for the test, and return None in this case.
        enclosingDirectory = os.path.dirname(enviroPath)
        codedTestFilePath = os.path.abspath(
            os.path.join(enclosingDirectory, test.coded_tests_file)
        )
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


def getEnviroSupportsMock(api):
    """
    The extension needs to know if the environment was built with mocking
    support, not just if the tool supports it.

    If the enviro was not built with mocking then the new mocking fields in the
    API will be set to None by the migration process.
    """

    currEnviroSupportsMocking = enviroSupportsMocking(api)
    return currEnviroSupportsMocking


def getTestDataVCAST(api, enviroPath):
    global globalListOfTestableFunctions
    global enviroSupportsMocking

    # Not currently used.
    # returns "None" if coverage is not initialized,
    # does not change based on coverage enabled/disabled
    try:
        coverageType = api.environment.coverage_type_text
    except Exception as err:
        # In this special case, vcast has given us a valid
        # handle to the API, so we need to close it here
        api.close()

        # the dataAPI does not automatically update the coverage DB
        # so we raise an error here if the cover.db is too old
        raise InvalidEnviro(err)

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
        # we used to add these and throw them away in the typescript, now we don't add them
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

                # Handles some special cases
                if tstUtilities.isTestableFunction(function):
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

    return testList


def getUnitData(api):
    """
    This function will return info about the units in an environment
    """
    unitList = list()

    sourceObjects = api.SourceFile.all()
    for sourceObject in sourceObjects:
        sourcePath = sourceObject.display_path
        if sourceObject.is_instrumented:
            covered, uncovered, partiallyCovered, checksum = getCoverageData(
                sourceObject
            )
            unitInfo = dict()
            unitInfo["path"] = sourcePath
            unitInfo["functionList"] = getFunctionData(sourceObject)
            unitInfo["cmcChecksum"] = checksum
            unitInfo["covered"] = covered
            unitInfo["uncovered"] = uncovered
            unitInfo["partiallyCovered"] = partiallyCovered
            unitList.append(unitInfo)

        elif len(sourcePath) > 0:
            # we save "empty" unit data for files that are not
            # instrumented so that the the extension can display
            # "No Coverage Data" for these ...
            unitInfo = dict()
            unitInfo["path"] = sourcePath
            unitInfo["functionList"] = []
            unitInfo["cmcChecksum"] = "0"
            unitInfo["covered"] = ""
            unitInfo["uncovered"] = ""
            unitInfo["partiallyCovered"] = ""
            unitList.append(unitInfo)

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


# For the purposes of the extension we only care about statement
# or branch coverage, so we handle all the possible coverage types
# here and boil them down to an enum of none, statement, branch
class CoverageKind:
    other = 0
    statement = 1
    branch = 2
    statementBranch = 3
    statementMcdc = 4
    mcdc = 5
    ignore = 6


statementCoverList = [
    COVERAGE_TYPE_TYPE_T.STATEMENT,
    COVERAGE_TYPE_TYPE_T.STATEMENT_FUNCTION_CALL,
    COVERAGE_TYPE_TYPE_T.STATEMENT_BRANCH_FUNCTION_CALL,
]

mcdcCoverageList = [
    COVERAGE_TYPE_TYPE_T.STATEMENT_MCDC,
    COVERAGE_TYPE_TYPE_T.STATEMENT_MCDC_FUNCTION_CALL,
]

branchCoverageList = [
    COVERAGE_TYPE_TYPE_T.STATEMENT_BRANCH,
    COVERAGE_TYPE_TYPE_T.STATEMENT_BRANCH_FUNCTION_CALL,
]


def getCoverageKind(sourceObject):
    """
    This function will return:
    statement: for statement, statement+branch, statement+mcdc, etc.
    branch: for branch
    mcdc: for mcdc
    none: for everything else.
    """

    # vc23sp2 added a function called get_coverage_type_text, but to support
    # older version of vcast, we do the interpretation of the enum manually here
    if sourceObject.coverage_type in statementCoverList:
        return CoverageKind.statement
    elif sourceObject.coverage_type in branchCoverageList:
        return CoverageKind.statementBranch
    elif sourceObject.coverage_type in mcdcCoverageList:
        return CoverageKind.statementMcdc
    elif sourceObject.coverage_type == COVERAGE_TYPE_TYPE_T.MCDC:
        return CoverageKind.mcdc
    elif sourceObject.coverage_type == COVERAGE_TYPE_TYPE_T.BRANCH:
        return CoverageKind.branch
    else:
        return CoverageKind.ignore


def getCoverageData(sourceObject):
    """
    This function will use the data interface to
    get the coverage data for a single file
    """
    coveredString = ""
    uncoveredString = ""
    partiallyCoveredString = ""
    checksum = 0
    if sourceObject and sourceObject.is_instrumented:

        # Unit name with deleted extension.
        # Normally i would do it with sourceObject.unit_name but release 21 does not have this method.
        unitFile = sourceObject.cover_data.name
        unit = unitFile.rsplit(".", 1)[0]

        # We need to get the lines where the function starts to filter them out, because otherwise they are also recognized as "Branches"
        functionLineList = []
        for function in sourceObject.cover_data.functions:
            functionLineList.append(function.start_line)

        checksum = sourceObject.checksum
        coverageKind = getCoverageKind(sourceObject)
        mcdc_line_dic = coverageGutter.getMCDCLineDic(sourceObject)
        # iterate_coverage crashes if the file path doesn't exist
        if os.path.exists(sourceObject.path):
            for line in sourceObject.iterate_coverage():

                # STATEMENT
                if coverageKind == CoverageKind.statement:
                    coveredString, uncoveredString = (
                        coverageGutter.handleStatementCoverage(
                            line,
                            coveredString,
                            uncoveredString,
                        )
                    )

                # MCDC
                elif coverageKind == CoverageKind.mcdc:
                    coveredString, partiallyCoveredString, uncoveredString = (
                        coverageGutter.handleMcdcCoverage(
                            unit,
                            mcdc_line_dic,
                            line,
                            coveredString,
                            partiallyCoveredString,
                            uncoveredString,
                        )
                    )

                # STATEMENT + MCDC
                elif coverageKind == CoverageKind.statementMcdc:
                    coveredString, partiallyCoveredString, uncoveredString = (
                        coverageGutter.handleStatementMcdcCoverage(
                            unit,
                            mcdc_line_dic,
                            line,
                            coveredString,
                            partiallyCoveredString,
                            uncoveredString,
                        )
                    )

                # STATEMENT + BRANCH
                elif coverageKind == CoverageKind.statementBranch:
                    coveredString, partiallyCoveredString, uncoveredString = (
                        coverageGutter.handleStatementBranchCoverage(
                            line,
                            coveredString,
                            partiallyCoveredString,
                            uncoveredString,
                        )
                    )

                # BRANCH
                elif coverageKind == CoverageKind.branch:
                    coveredString, partiallyCoveredString, uncoveredString = (
                        coverageGutter.handleBranchCoverage(
                            line,
                            functionLineList,
                            coveredString,
                            partiallyCoveredString,
                            uncoveredString,
                        )
                    )

            # print, but drop the last colon
            coveredString = coveredString[:-1]
            uncoveredString = uncoveredString[:-1]
            partiallyCoveredString = partiallyCoveredString[:-1]

    return coveredString, uncoveredString, partiallyCoveredString, checksum


def executeVCtest(enviroPath, testIDObject):
    with cd(os.path.dirname(enviroPath)):
        returnText = ""

        returnCode, commandOutput = clicastInterface.executeTest(
            enviroPath, testIDObject
        )

        # the return codes are defined in clicast.ads -> CLICAST_STATUS_T
        # 0 means the command ran and the test passed
        # 28 means the command ran and the test failed
        # we will treat everything else as a command fail
        if returnCode == 0 or returnCode == 28:
            if "TEST RESULT: pass" in commandOutput:
                returnText += "STATUS:passed\n"
            else:
                returnText += "STATUS:failed\n"
            returnText += f"REPORT:{testIDObject.reportName}\n"

            # Retrieve the expected value x/y and the test time
            # we don't need to catch dataAPI errors here because
            # if there is a problem with a version miss-match
            # we will have already gotten a return code of 15
            # and not be in this block
            api = UnitTestApi(enviroPath)
            testList = api.TestCase.filter(name=testIDObject.testName)
            if len(testList) > 0:
                returnText += f"PASSFAIL:{getPassFailString(testList[0])}\n"
                returnText += f"TIME:{getTime(testList[0].start_time)}\n"
            api.close()

            returnText += commandOutput.rstrip()
        else:
            returnText = commandOutput

        return returnCode, returnText.rstrip()


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
        try:
            # Attempt to generate the report
            clicastInterface.generate_report(testIDObject)
            returnText = f"REPORT:{testIDObject.reportName}\n"
        except Exception as e:
            returnText = f"Error: {str(e)}\n"

        return returnText


def getCodeBasedTestNames(filePath):
    """
    This function will use the same file parser that vcast
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
        self.reportName = os.path.join(enviroPath, hashString) + ".html"


def validateClicastCommand(command, mode):
    """
    The --clicast arg is only required for a sub-set of modes, so we do
    those checks here, and throw usage error if there is a problem
    """
    if mode in ["executeTest", "rebuild"]:
        if command is None or len(command) == 0:
            raise UsageError("--clicast argument is required")
        elif os.path.isfile(command) or (
            sys.platform == "win32" and os.path.isfile(command + ".exe")
        ):
            pass
        else:
            raise UsageError("--clicast argument is invalid, file does not exist")


def validatePath(pathString):
    if not os.path.isdir(pathString) and not os.path.isfile(pathString):
        raise UsageError("--path argument is invalid, path does not exist")


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
            raise UsageError("--options argument is invalid, value not JSON formatted")
    return returnObject


def isManageEnviroOfInterest(enviroNode):

    returnValue = False
    # we only care about unit test environments
    if enviroNode.definition.env_type != EnvironmentType.COVER:
        # we don't care about ignored or monitored environments
        if enviroNode.is_active and not enviroNode.is_monitored:
            returnValue = True

    return returnValue


def manageEnviroIsBuilt(enviroNode, enviroName):
    returnValue = False

    if os.path.isdir(enviroNode.build_directory) and os.path.isfile(
        os.path.join(enviroNode.build_directory, enviroName, "UNITDATA.VCD")
    ):
        returnValue = True

    return returnValue


def getProjectData(api):

    enviroList = []
    for enviroNode in api.Environment.all():
        if isManageEnviroOfInterest(enviroNode):
            enviroData = {}
            testsuites = []
            # string_path is the compiler/test-suite/[group]/enviro string
            enviroName = enviroNode.string_path.rsplit("/", 1)[1]
            enviroData["displayName"] = enviroNode.string_path
            enviroData["buildDirectory"] = (
                enviroNode.build_directory.replace("\\", "/") + "/" + enviroName
            )
            enviroData["isBuilt"] = manageEnviroIsBuilt(enviroNode, enviroName)
            enviroData["rebuildNeeded"] = enviroNode.rebuild_needed
            enviroData["methods"] = [
                attr
                for attr in dir(enviroNode.compiler)
                if callable(getattr(enviroNode.compiler, attr))
                and not attr.startswith("__")
            ]
            enviroData["properties"] = [
                attr
                for attr in dir(enviroNode.compiler)
                if not callable(getattr(enviroNode.compiler, attr))
                and not attr.startswith("__")
            ]

            if enviroNode.compiler.is_enabled:
                enviroData["compiler"] = {
                    "name": enviroNode.compiler.name,
                    "testsuites": testsuites,
                }

            for testsuite in enviroNode.compiler.testsuites:
                if testsuite.is_enabled:
                    testsuite_name_full = testsuite.string_id
                    testsuites.append(testsuite_name_full.split("/")[1])

            enviroList.append(enviroData)
    return enviroList


def getProjectTestsuiteData(api):
    testsuiteList = []
    for testsuite in api.TestSuite.all():
        if testsuite.is_enabled:
            testsuiteData = {}
            testsuiteData["displayName"] = testsuite.string_id
            testsuiteList.append(testsuiteData)
    return testsuiteList


def getProjectCompilerData(api):
    compilerList = []
    for compiler in api.Compiler.all():
        if compiler.is_enabled:
            compilerData = {}
            compilerData["displayName"] = compiler.name
            compilerData["projectFile"] = compiler.project.path
            compilerList.append(compilerData)
    return compilerList


def processCommandLogic(mode, clicast, pathToUse, testString="", options=""):
    """
    This function does the actual work of processing a vTestInterface command,
    it will return a dictionary with the results of the command
    """

    returnCode = 0
    returnObject = None

    # no need to pass this all around
    # will raise usageError if path is invalid
    validateClicastCommand(clicast, mode)
    pythonUtilities.globalClicastCommand = clicast

    # will raise usageError if path is invalid
    validatePath(pathToUse)

    if mode == "getProjectData":
        topLevel = dict()

        try:
            api = VCProjectApi(pathToUse)
        except Exception as err:
            raise UsageError(err)

        topLevel["projectEnvData"] = getProjectData(api)
        topLevel["projectTestsuiteData"] = getProjectTestsuiteData(api)
        topLevel["projectCompilerData"] = getProjectCompilerData(api)

        api.close()
        returnObject = topLevel

    elif mode == "getEnviroData":
        topLevel = dict()

        try:
            api = UnitTestApi(pathToUse)
        except Exception as err:
            raise UsageError(err)

        # it's important that getTetDataVCAST() is called first since it sets up
        # the global list of testable functions that getUnitData() needs
        topLevel["testData"] = getTestDataVCAST(api, pathToUse)
        topLevel["unitData"] = getUnitData(api)
        topLevel["enviro"] = dict()
        topLevel["enviro"]["mockingSupport"] = getEnviroSupportsMock(api)

        api.close()
        returnObject = topLevel

    elif mode == "executeTest":
        try:
            testIDObject = testID(pathToUse, testString)
            # remove any left over report file ...
            textReportPath = testIDObject.reportName
            if os.path.isfile(textReportPath):
                os.remove(textReportPath)
        except:
            raise UsageError("--test argument is invalid")
        returnCode, returnText = executeVCtest(pathToUse, testIDObject)
        returnObject = {"text": returnText.split("\n")}

    elif mode == "report":
        try:
            testIDObject = testID(pathToUse, testString)
        except:
            print("Invalid test ID, provide a valid --test argument")
            raise UsageError("--test argument is invalid")
        returnObject = {"text": getResults(pathToUse, testIDObject).split("\n")}

    elif mode == "mcdcReport":
        try:
            jsonOptions = processOptions(options)
            # Access individual fields
            unitName = jsonOptions.get("unitName")
            lineNumber = jsonOptions.get("lineNumber")
        except:
            print("Invalid options, provide a valid --options argument")
            raise UsageError("--options argument is invalid")
        returnObject = {
            "text": getMCDCResults(pathToUse, unitName, lineNumber).split("\n")
        }

    elif mode == "parseCBT":
        # This is a special mode used by the unit test driver to parse the CBT
        # file and generate the test list.
        returnObject = getCodeBasedTestNames(pathToUse)

    elif mode == "rebuild":
        # Rebuild environment has some special processing because we want
        # to incorporate any changed build settings, like coverageKind

        # we don't set the return object for rebuild, because we echo in real-time
        jsonOptions = processOptions(options)
        returnCode, commandOutput = clicastInterface.rebuildEnvironment(
            pathToUse, jsonOptions
        )
        returnObject = {"text": commandOutput.split("\n")}

    else:
        modeListAsString = ",".join(modeChoices)
        raise UsageError(
            f"--mode: {mode} is invalid, must be one of: {modeListAsString}"
        )

    # only used for executeTest currently
    return returnCode, returnObject


def processCommand(mode, clicast, pathToUse, testString="", options=""):
    """
    This is a wrapper for process command logic, so that we can process
    the exceptions in a single place for stand-alone (via main) and server usage
    """
    try:
        returnCode, returnObject = processCommandLogic(
            mode, clicast, pathToUse, testString, options
        )

    # because vpython and clicast use a large range of positive return codes
    # we use values > 990 for internal tool errors
    except InvalidEnviro as error:
        returnCode = errorCodes.testInterfaceError
        whatToReturn = ["Miss-match between Environment and VectorCAST versions"]
        whatToReturn.extend(str(error).split("\n"))
        returnObject = {"text": whatToReturn}
    except UsageError as error:
        # for usage error we print the issue where we see it
        returnCode = errorCodes.testInterfaceError
        returnObject = {"text": [str(error)]}
    except Exception:
        returnCode = errorCodes.testInterfaceError
        traceBackText = traceback.format_exc().split("\n")
        returnObject = {"text": traceBackText}

    return returnCode, returnObject


def processMCDCLogic(mode, clicast, pathToUse, unitName, lineNumber):
    returnCode = 0
    returnObject = None

    # no need to pass this all around
    # will raise usageError if path is invalid
    validateClicastCommand(clicast, mode)
    pythonUtilities.globalClicastCommand = clicast

    # will raise usageError if path is invalid
    validatePath(pathToUse)

    if mode == "mcdcReport":
        returnObject = {
            "text": getMCDCResults(pathToUse, unitName, lineNumber).split("\n")
        }
    elif mode == "mcdcLines":
        returnObject = {"text": getMCDCLines(pathToUse).split("\n")}
    else:
        modeListAsString = ",".join(modeChoices)
        raise UsageError(
            f"--mode: {mode} is invalid, must be one of: {modeListAsString}"
        )
    return returnCode, returnObject


def processMCDCCommand(mode, clicast, pathToUse, unitName="", lineNumber=-1):
    """
    This is a wrapper for process mcdc command logic, so that we can process
    the exceptions in a single place for stand-alone (via main) and server usage
    """
    try:
        returnCode, returnObject = processMCDCLogic(
            mode, clicast, pathToUse, unitName, lineNumber
        )

    # because vpython and clicast use a large range of positive return codes
    # we use values > 990 for internal tool errors
    except InvalidEnviro as error:
        returnCode = errorCodes.testInterfaceError
        whatToReturn = ["Miss-match between Environment and VectorCAST versions"]
        whatToReturn.extend(str(error).split("\n"))
        returnObject = {"text": whatToReturn}
    except UsageError as error:
        # for usage error we print the issue where we see it
        returnCode = errorCodes.testInterfaceError
        returnObject = {"text": [str(error)]}
    except Exception:
        returnCode = errorCodes.testInterfaceError
        traceBackText = traceback.format_exc().split("\n")
        returnObject = {"text": traceBackText}

    return returnCode, returnObject


def getMCDCResults(enviroPath, unitName, lineNumber):
    """
    Returns the MCDC Report for a specific line in a specific unit.
    """
    with cd(os.path.dirname(enviroPath)):
        commands = list()
        commands.append("mcdcReport")
        try:
            # Create a hash for the report name based on the params
            temp = ".".join([unitName, str(lineNumber)])
            hashString = hashlib.md5(temp.encode("utf-8")).hexdigest()
            reportName = os.path.join(enviroPath, hashString) + ".html"

            # Attempt to generate the report
            mcdcReport.generate_mcdc_report(
                enviroPath, unitName, lineNumber, reportName
            )

            # If mcdc report generation does not fail, we return the name of the file
            returnText = f"REPORT:{reportName}\n"
        except Exception as e:
            returnText = f"Error: {str(e)}\n"

        return returnText


def getMCDCLines(enviroPath):
    """
    Returns all MCDC lines for all units within an environment.
    """
    with cd(os.path.dirname(enviroPath)):
        commands = list()
        commands.append("mcdcLines")
        try:
            # Attempt to retrieve the lines
            mcdcLines = mcdcReport.get_mcdc_lines(enviroPath)
            returnText = f"{mcdcLines}\n"
        except Exception as e:
            returnText = f"Error: {str(e)}\n"

        return returnText


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

    returnCode = main()
    sys.exit(int(returnCode))
