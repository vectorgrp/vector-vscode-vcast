"""
This script is simply for testing the dataAPI and clicast servers.
Everything that is here will be implemented in typescript in the extension
"""

import argparse
import glob
import json
import os
import pathlib
import requests
import shutil
import subprocess
import sys
import time
import traceback


# Because this is test code, I think it's ok to set the path this way
# Note that settings.json has a value for "python.analysis.extraPaths"
# to make the IntelliSense work for these files
thisFileLocation = str(pathlib.Path(__file__).parent.resolve())
sys.path.append(os.path.join(thisFileLocation, "..", "..", "python"))

import vcastDataServerTypes
from vcastDataServerTypes import commandType, errorCodes

from buildMultipleEnvironments import buildMultipleEnvironments


from vector.lib.core.system import cd

# Path to where the test should be run ...
ENVIRO_PATH = ""
SCALABILITY_PATH = ""

try:
    VECTORCAST_DIR = os.environ["VECTORCAST_DIR"]
except:
    print("VECTORCAST_DIR environment variable not set")
    sys.exit(1)


def serverURL():
    return f"http://{vcastDataServerTypes.HOST}:{vcastDataServerTypes.PORT}"


def cleanEnviroData(newData):
    """
    We want to clean any file paths, these are in two places:
    the data.testData, and data.unitData
    """
    for item in newData["data"]["testData"]:
        if "path" in item:
            item["path"] = os.path.basename(item["path"])

    for item in newData["data"]["unitData"]:
        if "path" in item:
            item["path"] = os.path.basename(item["path"])

    return newData


# for some reason, once a coded test is added to an environment
# vcast always does this extra work on test execution, so we strip
# these messages if they are there
outputLinesToIgnore = [
    "Creating expanded header information for manager",
    "Compiling file manager",
    "Linking Instrumented Harness",
    "Relink complete",
]


def cleanClicastCommand(line):
    """
    For compatibility between Windows and Linux
    """
    newLine = line.replace('"CLICAST"', "clicast")
    newLine = newLine.replace("/E:DEMO1", "-eDEMO1")
    return newLine


def cleanExecutionData(newData):
    """
    For compatibility between tool versions, locations and platforms
    """
    currentList = newData["data"]["text"]
    newList = []
    for line in currentList:
        if line.startswith("REPORT:"):
            newList.append("REPORT: report.txt")
        elif line.startswith("TIME:"):
            newList.append("TIME: 00:00:00")
        elif "report custom actual" in line:
            pieces = line.split("report custom actual")
            newLine = f"{pieces[0]} report custom actual report.txt"
            newLine = cleanClicastCommand(newLine)
            newList.append(newLine)
        elif "report was saved to" in line:
            pieces = line.split("report was saved to")
            newList.append(f"{pieces[0]} report was saved to report.txt")
        elif "Running command" in line:
            newList.append(cleanClicastCommand(line))
        elif line.strip() in outputLinesToIgnore:
            pass
        else:
            newList.append(line)
    newData["data"]["text"] = newList

    return newData


def cleanCBTData(newData):
    """
    For compatibility between tool versions, locations and platforms
    The data is a list of dictionaries, and the key we want to "clean"
    is: "codedTestFile", we just change abs path to filename only
    """

    currentList = newData["data"]["tests"]
    newList = []
    for test in currentList:
        if "codedTestFile" in test:
            test["codedTestFile"] = os.path.basename(test["codedTestFile"])
        newList.append(test)

    newData["data"]["tests"] = newList

    return newData


def compareJSON(left, right):
    """
    Compare two JSON objects for equality
    """
    leftString = json.dumps(left)
    rightString = json.dumps(right)

    return leftString == rightString


def compareTestScriptFiles(expected, actual):
    """
    This is used to compare two test scripts.
    The first line in the scripts is the vcast version
    so we need to ignore that line for the compare
    """

    with open(expected, "r") as f:
        expectedData = f.readlines()
        expectedData = "\n".join(expectedData[1:])

    with open(actual, "r") as f:
        actualData = f.readlines()
        actualData = "\n".join(actualData[1:])

    returnValue = expectedData == actualData

    if not returnValue:
        print(
            f"-- Data miss-match - compare: {os.path.basename (expected)}  to: {os.path.basename(actual)} ..."
        )

    return returnValue


def compareToExpected(expectedFile, newData):

    expectedFilePath = os.path.join(thisFileLocation, "expected-files", expectedFile)
    with open(expectedFilePath, "r") as f:
        expectedData = json.load(f)
    returnValue = compareJSON(expectedData, newData)

    if not returnValue:
        print(f"-- Data miss-match - compare: {expectedFilePath}  to: failed.json ...")
        with open("failed.json", "w") as f:
            json.dump(newData, f, indent=4)

    return returnValue


def transmitTestCommand(requestObject):

    # TBD: is this the right way to do this, or can I send a class directly?
    # request is a class, so we convert it to a dictionary, then a string
    dataAsString = json.dumps(requestObject.toDict())
    returnData = requests.get(
        f"{serverURL()}/runcommand", params={"request": dataAsString}
    )
    return returnData.json()


def pingServerTest():
    """
    Simply ping the server - we are only testing the "good" case
    """

    print("Starting pingServer Test")

    try:
        returnData = requests.get(f"{serverURL()}/ping")
        returnData = returnData.json()
    except Exception as error:
        print(f"-- Could not connect to server at {serverURL()}")
        assert False
    if "text" in returnData:
        responseText = returnData["text"]
        assert responseText.startswith("alive")
        print("   pingServer Test Passed")
    else:
        print(f"-- Server at {serverURL()} did not respond to ping")
        assert False


def getEnviroDataTest(clicastPath, enviroPath):

    print("Starting getEnviroData Test")

    request = vcastDataServerTypes.clientRequest(
        commandType.getEnviroData, clicastPath, enviroPath
    )
    returnData = transmitTestCommand(request)
    returnData = cleanEnviroData(returnData)
    assert compareToExpected("expected-getEnviroData.json", returnData)
    print("   getEnviroData Test Passed")


def parseCBTTest(clicastPath):

    print("  parseCBT Test")
    codedTestFilePath = os.path.join(ENVIRO_PATH, codedTestFile)
    request = vcastDataServerTypes.clientRequest(
        commandType.parseCBT, clicastPath, codedTestFilePath
    )
    returnData = transmitTestCommand(request)
    returnData = cleanCBTData(returnData)

    assert compareToExpected("expected-getCBTTest.json", returnData)
    print("     parseCBT Test Passed")


def testCaseTests(clicastPath, enviroPath, testString):
    """
    This function will run all of the clicast based test case tests
    """

    print("Starting Test Script Tests ...")

    # loadTestCase
    print("  Loading test case into enviro ...")
    testScriptFile = "manager-test.tst"
    enviroName = os.path.basename(enviroPath)
    commandText = f"-e{enviroName} test script run {testScriptFile}"
    request = vcastDataServerTypes.clientRequest(
        commandType.runClicastCommand, clicastPath, enviroPath, options=commandText
    )
    returnData = transmitTestCommand(request)
    exitCode = int(returnData["exitCode"])
    assert exitCode == 0
    print("     loadTestCase Test Passed")

    # executeTest
    print("  Executing Test ...")
    request = vcastDataServerTypes.clientRequest(
        commandType.executeTest, clicastPath, enviroPath, testString
    )
    returnData = transmitTestCommand(request)
    # fix up stuff that changes between runs ...
    returnData = cleanExecutionData(returnData)
    assert compareToExpected("expected-executeTest.json", returnData)
    print("     executeTest Test Passed")

    # report
    print("  Report Test ...")
    request = vcastDataServerTypes.clientRequest(
        commandType.report, clicastPath, enviroPath, testString
    )
    returnData = transmitTestCommand(request)
    # fix up stuff that changes between runs ...
    returnData = cleanExecutionData(returnData)
    assert compareToExpected("expected-report.json", returnData)
    print("     Report Test Passed")

    # createTestScript
    print("  Creating Test Script ...")
    enviroName = os.path.basename(enviroPath)
    commandText = f"-e{enviroName} test script create newTestScript.tst"
    request = vcastDataServerTypes.clientRequest(
        commandType.runClicastCommand, clicastPath, enviroPath, "", commandText
    )
    returnData = transmitTestCommand(request)
    exitCode = int(returnData["exitCode"])
    assert exitCode == 0
    enviroLocation = os.path.dirname(enviroPath)
    assert compareTestScriptFiles(
        os.path.join(enviroLocation, testScriptFile),
        os.path.join(enviroLocation, "newTestScript.tst"),
    )
    print("     createTestScript Test Passed")

    # deleteTestCase
    print("  Deleting test cases ...")
    enviroName = os.path.basename(enviroPath)
    commandText = f"-e{enviroName} test delete all"
    request = vcastDataServerTypes.clientRequest(
        commandType.runClicastCommand, clicastPath, enviroPath, "", commandText
    )
    returnData = transmitTestCommand(request)
    exitCode = int(returnData["exitCode"])
    assert exitCode == 0
    print("     deleteTestCase Test Passed")


# Test that will be appended to the coded test file to test refresh
newCodedTest = "\n\nVTEST(managerTests, newTest) {\n  VASSERT_EQ(2, 1+1);\n}\n"
codedTestFile = "manager-coded.cpp"
codedTestBackupFile = "manager-coded.cpp.bak"


def codedTestTests(clicastPath, enviroPath):
    """
    The code to add a coded test is the same for add and new so we
    are only testing add because then we know the test name etc.
    We are doing the execute after update to make sure that the
    update works, since there was a bug with this during development
    """

    print("Starting Coded Test Tests ...")

    # addCodedTest
    print("  Add Coded Test")
    request = vcastDataServerTypes.clientRequest(
        commandType.runClicastCommand,
        clicastPath,
        enviroPath,
        "",
        f"-eDEMO1 -umanager test coded add {codedTestFile}",
    )
    returnData = transmitTestCommand(request)
    exitCode = int(returnData["exitCode"])
    assert exitCode == 0
    print("     addCodedTest passed")

    # executeCodedTest - pass
    print("  Execute Coded Test - pass")
    testString = "DEMO1|manager.coded_tests_driver.managerTests.pass"
    request = vcastDataServerTypes.clientRequest(
        commandType.executeTest, clicastPath, enviroPath, testString
    )
    returnData = transmitTestCommand(request)
    exitCode = int(returnData["exitCode"])
    assert exitCode == 0

    # executeCodedTest - fail
    print("  Execute Coded Test - fail")
    testString = "DEMO1|manager.coded_tests_driver.managerTests.fail"
    request = vcastDataServerTypes.clientRequest(
        commandType.executeTest, clicastPath, enviroPath, testString
    )
    returnData = transmitTestCommand(request)
    exitCode = int(returnData["exitCode"])
    assert exitCode == 28
    print("     executeCodedTestPassed")

    # refreshCodedTest
    print("  Appending to coded test file")
    codedTestFilePath = os.path.join(ENVIRO_PATH, codedTestFile)
    shutil.copyfile(codedTestFilePath, codedTestBackupFile)
    with open(codedTestFilePath, "a") as f:
        f.write(newCodedTest)

    print("  Calling Refresh ")
    request = vcastDataServerTypes.clientRequest(
        commandType.runClicastCommand,
        clicastPath,
        enviroPath,
        "",
        "-eDEMO1 test coded refresh",
    )
    returnData = transmitTestCommand(request)
    exitCode = int(returnData["exitCode"])
    assert exitCode == 0
    print("     refresehCodedTestPassed")

    # This will ensure that the coded test file was updated
    parseCBTTest(clicastPath)

    print("  Execute New Coded Test")
    testString = "DEMO1|manager.coded_tests_driver.managerTests.pass"
    request = vcastDataServerTypes.clientRequest(
        commandType.executeTest, clicastPath, enviroPath, testString
    )
    returnData = transmitTestCommand(request)
    exitCode = int(returnData["exitCode"])
    assert exitCode == 0
    print("     executeCodedTestPassed")

    # delete all test and recompile to cleanup
    print("  Deleting test cases ...")
    enviroName = os.path.basename(enviroPath)
    commandText = f"-e{enviroName} test delete all"
    request = vcastDataServerTypes.clientRequest(
        commandType.runClicastCommand, clicastPath, enviroPath, "", commandText
    )
    # we don't care about the return data
    transmitTestCommand(request)

    # Restore coded test file to the original version
    print("  Restoring coded test file")
    shutil.copyfile(codedTestBackupFile, codedTestFilePath)
    os.remove(codedTestBackupFile)


def closeConnectionTest(enviroPath):
    # choiceList
    print("Starting Close Connection Test")
    request = vcastDataServerTypes.clientRequest(
        commandType.closeConnection, path=enviroPath
    )
    returnData = transmitTestCommand(request)
    # True means that a connection was closed
    assert returnData["data"]["status"] == True
    # newList should be empty because only one enviro connection existed
    assert len(returnData["data"]["newlist"]) == 0
    print("   closeConnection Test Passed")


def completionTest(enviroPath):

    # choiceList
    print("Starting completion Test")

    print("  starting TST completion ...")
    request = vcastDataServerTypes.clientRequest(
        commandType.choiceListTst, path=enviroPath, options="TEST.VALUE:"
    )
    returnData = transmitTestCommand(request)
    assert compareToExpected("expected-completion-tst.json", returnData)
    print("     TST completionTest Test Passed")

    print("  starting MOCK completion test ...")
    request = vcastDataServerTypes.clientRequest(
        commandType.choiceListCT, path=enviroPath, options="// vmock "
    )
    returnData = transmitTestCommand(request)
    assert compareToExpected("expected-completion-ct.json", returnData)
    print("     MOCK completionTest Test Passed")

    print("  completionTest Test Passed")


def rebuildTest(clicastPath, enviroPath):
    # rebuild
    print("Starting Environment Rebuild Test")

    optionsDict = {"ENVIRO.COVERAGE_TYPE": "Statement"}
    optionsString = json.dumps(optionsDict)

    request = vcastDataServerTypes.clientRequest(
        commandType.rebuild, clicastPath, enviroPath, options=optionsString
    )
    returnData = transmitTestCommand(request)
    # fix up stuff that changes between runs ...
    returnCode = returnData["exitCode"]
    assert returnCode == 0
    print("   Environment Rebuild Test Passed")


def sendShutdownToServer():
    try:
        # this will throw because the server process will exit
        requests.get(f"{serverURL()}/shutdown")
    except Exception as error:
        pass
    print("Server has been shutdown")


numberOfGetEnviroDataCallsToMake = 100
numberOfEnvironments = 10


def getEnviroDataMultipleTimesUsingVPython(clicastPath, enviroPath):

    print(
        f"  Calling vpython {numberOfGetEnviroDataCallsToMake} times with a getEnviroData ..."
    )
    vpythonCommand = sys.executable
    # Get the path to this script and then figure out the path to vTestInterface.py
    pathToThisScript = sys.argv[0]
    pathTovTestInterface = os.path.realpath(
        os.path.join(pathToThisScript, "..", "..", "..", "python", "vTestInterface.py")
    )
    commandToRun = f"{vpythonCommand} {pathTovTestInterface} --mode=getEnviroData --path={enviroPath}"
    startTime = time.time()
    alreadyChecked = False
    for i in range(numberOfGetEnviroDataCallsToMake):
        try:
            # debug print (f"  executing command: {commandToRun} ...")
            commandOutput = subprocess.check_output(
                commandToRun, shell=True, stderr=subprocess.STDOUT
            )
            # make sure we get valid data after the first call
            commandOutput = commandOutput.decode().split("ACTUAL-DATA")[1]
            jsonData = json.loads(commandOutput)
            assert alreadyChecked or len(jsonData["unitData"]) > 0
            alreadyChecked = True
        except subprocess.CalledProcessError as error:
            print(f"  error running vpython getEnviroData command ...")
            print(f"  {error.output.decode()}")
            assert False
    elapsedTime = time.time() - startTime
    print(
        f"    completed {numberOfGetEnviroDataCallsToMake} calls in: {elapsedTime:.2f} seconds"
    )


def getEnviroDataMultipleTimesUsingTheServer(clicastPath, enviroPath):
    """
    Run the getEnviroData command multiple times and record elapsed time
    """
    print(
        f"  Sending {numberOfGetEnviroDataCallsToMake} getEnviroData commands to the server ..."
    )

    startTime = time.time()
    alreadyChecked = False
    for i in range(numberOfGetEnviroDataCallsToMake):
        request = vcastDataServerTypes.clientRequest(
            commandType.getEnviroData, clicastPath, enviroPath
        )
        # request is a class, so we convert it to a dictionary, then a string
        dataAsString = json.dumps(request.toDict())
        response = requests.get(
            f"{serverURL()}/runcommand", params={"request": dataAsString}
        )
        jsonData = response.json()["data"]
        assert alreadyChecked or len(jsonData["unitData"]) > 0
        alreadyChecked = True

    elapsedTime = time.time() - startTime

    print(
        f"    completed {numberOfGetEnviroDataCallsToMake} calls in: {elapsedTime:.2f} seconds"
    )


def timingTest(clicastPath, enviroPath):

    print("Starting Timing Test")
    getEnviroDataMultipleTimesUsingVPython(clicastPath, enviroPath)
    getEnviroDataMultipleTimesUsingTheServer(clicastPath, enviroPath)


def executeTestWithServer(clicastPath):
    """
    This test does a a test execution on N different environments to check the overhead
    of having N clicast server processes running.

    We run the whole thing 3 times and record the times, because the
    first command for each environment causes us to start a new clicast process
    The second and third runs result in much shorte times because clicast
    instances are already running.
    """

    if not os.path.isdir(SCALABILITY_PATH):
        print(f"  {SCALABILITY_PATH} does not exist")
    else:
        for i in range(1, 4):
            print(f"  starting iteration {i} ...")
            startTime = time.time()
            testStringSuffix = "|manager.Manager::PlaceOrder.Test1"
            with cd(SCALABILITY_PATH):
                # get a list of all the directories in the environment directory
                for i in range(1, numberOfEnvironments + 1):
                    enviroName = f"DEMO{i}"
                    enviroPath = os.path.join(SCALABILITY_PATH, enviroName)
                    testString = f"{enviroName}{testStringSuffix}"
                    print(
                        f"    executing test for enviro: {os.path.basename(enviroPath)}"
                    )
                    request = vcastDataServerTypes.clientRequest(
                        commandType.executeTest, clicastPath, enviroPath, testString
                    )
                    response = transmitTestCommand(request)
                    assert response["data"]["text"][0] == "STATUS:passed"

            elapsedTime = time.time() - startTime
            print(
                f"    elapsed time for {numberOfEnvironments}: {elapsedTime:.2f} seconds"
            )


def scalabilityTest(clicastPath):
    print("Starting Scalability Test")
    executeTestWithServer(clicastPath)


def fullTest(enviroPath, clicastPath, testString):

    getEnviroDataTest(clicastPath, enviroPath)
    testCaseTests(clicastPath, enviroPath, testString)
    codedTestTests(clicastPath, enviroPath)

    # ensure that we can force the termination of a connection
    closeConnectionTest(enviroPath)

    # note that this works even when a clicast process is active
    completionTest(enviroPath)

    # we do this last since it closes clicast process
    rebuildTest(clicastPath, enviroPath)

    # now do the error tests ...
    errorTests(clicastPath, enviroPath)


indent = "     "
dashes = "-" * 100


def printErrorResponse(errorList):

    print(indent + dashes)
    for error in errorList:
        print(indent + error)
    print(indent + dashes)


def errorTests(enviroPath, clicastPath):

    print("Starting Error Tests")

    # send an invalid request string to the server
    print("  Sending invalid request string to server")
    returnData = requests.get(
        f"{serverURL()}/runcommand", params={"request": "nonsense"}
    )
    returnData = returnData.json()
    exitCode = returnData["exitCode"]
    # Confirm that the error code is correct, and the error text is in a list
    assert exitCode == errorCodes.internalServerError
    assert returnData["data"]["error"][0].startswith(
        "client request was improperly formatted"
    )
    printErrorResponse(returnData["data"]["error"])
    print("     Invalid request string test passed")

    # Send an invalid command to the server
    print("  Sending invalid command to server")
    request = vcastDataServerTypes.clientRequest("bad-command", clicastPath, enviroPath)
    returnData = transmitTestCommand(request)
    exitCode = returnData["exitCode"]
    # Confirm that the error code is correct, and the error text is in a list
    assert exitCode == errorCodes.internalServerError
    assert returnData["data"]["error"][0].startswith("server does not support command")
    printErrorResponse(returnData["data"]["error"])
    print("     Invalid command test passed")

    # Send a command with invalid options to cause a stack trace
    print("  Sending command to cause a stack trace")
    request = vcastDataServerTypes.clientRequest(
        "crash-me", "bad-clicast-path", "bad-enviro-path"
    )
    returnData = transmitTestCommand(request)
    exitCode = returnData["exitCode"]
    # Confirm that the error code is correct, and the error text is in a list
    assert exitCode == errorCodes.internalServerError
    assert returnData["data"]["error"][0].startswith("internal server error")
    printErrorResponse(returnData["data"]["error"])
    print("     stack trace test passed")


def setupArgs():

    parser = argparse.ArgumentParser(description="VectorCAST Data Server Test Client")
    parser.add_argument("--test", required=True)
    parser.add_argument("--port", required=True, help="Server port number")
    parser.add_argument(
        "--nobuild", help=f"Do not build the environment", action="store_true"
    )
    return parser


def buildEnvironment(clicastPath):

    try:
        with cd(ENVIRO_PATH):
            commandToRun = f"{clicastPath} -lc enviro build DEMO1.env"
            # note: shell=true, requires commandToRun to be a string
            subprocess.run(
                commandToRun,
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                shell=True,
            )
    except subprocess.CalledProcessError as error:
        print(f"Error building DEMO1 environment: {error.stdout}")
        sys.exit(1)


def initializeEnvironment(clicastPath):
    """
    This functions sets up the Environment directory and builds the environment
    """

    print("Starting Client Initialization Processing ...")

    # Design to work in the clean directory case only
    if os.path.isdir(ENVIRO_PATH) == True:
        print(
            f"  Current directory already contains a '{ENVIRO_PATH}' sub-directory ... please remove"
        )
        sys.exit(1)

    # Make the enviro directory ...
    print("  Creating Environments directory ...")
    os.mkdir(ENVIRO_PATH)

    # and copy the vcast files into it.
    print("  Copying VectorCAST Enviro and Test Files ...")
    for filename in glob.glob(os.path.join(thisFileLocation, "vcast-files", "*.*")):
        shutil.copy(filename, ENVIRO_PATH)

    # and build the enviro
    print("  Building DEMO1 environment ...")
    buildEnvironment(clicastPath)
    print("  Environment created successfully ...\n\n")


def manualTest(args):

    # Replace with with a copy paste from the command being run in the extension
    commandToRun = '{"command":"runClicastCommand","path":"c:/RDS/VectorCAST/SERVER/e2e/unitTests/QUOTES_EXAMPLE","options":"-eQUOTES_EXAMPLE -uquotes_example -s\\"Moo::honk(int,int,int)\\" -tBASIS-PATH-001 test script create c:/RDS/VectorCAST/SERVER/e2e/unitTests/QUOTES_EXAMPLE.tst"}'

    print("Starting Manual Test ...")
    print(f"  running command: '{commandToRun[:80]}' ...")
    returnData = requests.get(
        f"{serverURL()}/runcommand", params={"request": commandToRun}
    )
    whatToPrint = json.dumps(returnData.json(), indent=4)
    print(f"  response: {whatToPrint}")


def enviroBasedTests(args):

    global ENVIRO_PATH
    global SCALABILITY_PATH

    clicastPath = f'{os.path.join (VECTORCAST_DIR, "clicast")}'
    ENVIRO_PATH = os.path.join(os.getcwd(), "SingleEnvironment")
    SCALABILITY_PATH = os.path.join(os.getcwd(), "MultipleEnvironments")

    if args.nobuild == False:
        if args.test == "timing":
            buildMultipleEnvironments(
                SCALABILITY_PATH, ENVIRO_PATH, numberOfEnvironments
            )
        else:
            initializeEnvironment(clicastPath)

    enviroUnderTest = os.path.join(ENVIRO_PATH, "DEMO1")
    if os.path.isdir(enviroUnderTest) == False:
        print(f"Test Environment: '{enviroUnderTest}' does not exist")
        sys.exit(1)

    enviroPath = f'{os.path.join (ENVIRO_PATH, "DEMO1")}'
    testString = "DEMO1|manager.Manager::PlaceOrder.Test1"

    if args.test == "shutdown":
        sendShutdownToServer()
    elif args.test == "timing":
        timingTest(clicastPath, enviroPath)
        scalabilityTest(clicastPath)
    elif args.test == "coded":
        codedTestTests(clicastPath, enviroPath)
    elif args.test == "close":
        closeConnectionTest(enviroPath)
    elif args.test == "rebuild":
        rebuildTest(clicastPath, enviroPath)
    elif args.test == "test":
        testCaseTests(clicastPath, enviroPath, testString)
    elif args.test == "data":
        getEnviroDataTest(clicastPath, enviroPath)
    elif args.test == "cbt":
        parseCBTTest(clicastPath)
    elif args.test == "errors":
        errorTests(clicastPath, enviroPath)
    elif args.test == "completion":
        completionTest(enviroPath)
    elif args.test == "full":
        fullTest(enviroPath, clicastPath, testString)
    else:
        print("Unknown test kind")


def main():
    """
    The common way to run the test is with
        vpython client.py --test=full

    To run timing and scalability tests, use:
        vpython client.py --test=timing
    """

    # If no arg is provided, the full tests will be run
    argParser = setupArgs()
    args, restOfArgs = argParser.parse_known_args()

    # process port arg
    # Note that PORT gets used by function serverURL()
    vcastDataServerTypes.processPortArg(args)

    # first we run the ping test, because if this fails ... what's the point
    pingServerTest()

    if args.test == "manual":
        manualTest(args)
    else:
        enviroBasedTests(args)


if __name__ == "__main__":
    try:
        main()
        sys.exit(0)

    except AssertionError:
        _, _, tb = sys.exc_info()
        tb_info = traceback.extract_tb(tb)
        filename, line, func, text = tb_info[-1]

        print(f"!! Assert failed @ line {line} in statement {text}")

    except requests.exceptions.ConnectionError:
        print("Server has terminated the connection")

    # allow ctr-c to stop program without messages
    except KeyboardInterrupt:
        print("Halting because of keyboard interrupt")

    except Exception as err:
        print(Exception, err)
        print(traceback.format_exc())
        print(" ")
