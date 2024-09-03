import os
import re
import shutil
import subprocess
import sys
import time

"""
This script contains the clicast stuff tha was previously 
in vTestInterface.py.  It was moved here to give access to the 
VectorCAST environment server.
"""

import pythonUtilities
from pythonUtilities import (
    cleanEnviroPath,
    clearClicastInstance,
    getClicastInstance,
    logMessage,
    setClicastInstance,
)
from vcastDataServerTypes import errorCodes

from vector.lib.core.system import cd

# Filename used when we run a clicast command script
commandFileName = "commands.cmd"


def connectClicastInstance(enviroPath):

    processObject = pythonUtilities.getClicastInstance(enviroPath)
    if processObject == None:

        commandArgs = [pythonUtilities.globalClicastCommand, "-lc", "tools", "server"]
        CWD = os.path.dirname(enviroPath)
        processObject = subprocess.Popen(
            commandArgs,
            stdout=subprocess.PIPE,
            stdin=subprocess.PIPE,
            stderr=sys.stdout,
            universal_newlines=True,
            cwd=CWD,
        )

        # A valid clicast server emits: "clicast-server-started"
        # if it has successfully initialized so we check for that
        # or we wait for the process to terminate which a non-server
        # clicast version will do.  Note that this is a failsafe
        # because we should never get here if the clicast is not
        # server capable.
        while True:
            responseLine = processObject.stdout.readline()
            if responseLine.startswith("clicast-server-started"):
                clicastInstanceRunning = True
                break
            elif processObject.poll() is not None:
                clicastInstanceRunning = False
                processObject = None
                break

        if clicastInstanceRunning:
            setClicastInstance(enviroPath, processObject)
        else:
            logMessage(
                f"  could not start clicast instance for environment: {enviroPath}"
            )
            logMessage(f"  using command: {' '.join (commandArgs)}")

    return processObject


def runClicastServerCommand(enviroPath, commandString):
    """
    Note: we indent the log messages here to make them easier to
    read in the context of the original server command received
    """

    # This call will return the processObject or None
    processObject = connectClicastInstance(enviroPath)

    if processObject == None:
        exitCode = errorCodes.couldNotStartClicastInstance
        returnText = "Could not start clicast instance"

    else:
        logMessage(f"    commandString: {commandString}")
        processObject.stdin.write(f"{commandString}\n")
        processObject.stdin.flush()

        responseLine = ""
        returnText = ""

        # The clicast server emits a line like this to mark the end of a command:
        #   clicast-server-command-done:COMMAND_NOT_ALLOWED | 8
        # Between the colon and the command is the status enum, and the
        # number after the | is the 'pos of the enum which is the normal
        # exit code for a clicast command.
        while not responseLine.startswith("clicast-server-command-done"):
            returnText += responseLine
            responseLine = processObject.stdout.readline()

        exitCode = int(responseLine.split("|")[1].strip())
        logMessage(f"    server return code: {exitCode}")

    return exitCode, returnText


def terminateClicastProcess(enviroPath):
    """
    This function will terminate any clicast process that exists for enviroPath
    It is used before things like delete and re-build environment, since we need
    to delete the environment directory, and the running process will have it locked
    if we are in server mode, we return True if we terminated a process, False otherwise
    """

    returnValue = False
    if pythonUtilities.USE_SERVER:
        processObject = getClicastInstance(enviroPath)
        if processObject != None:
            logMessage(
                f"  terminating clicast instance [{processObject.pid}] for environment: {enviroPath}"
            )
            # This tells clicast to shutdown gracefully
            # In the case where the server has been stopped with ctrl-c
            # we get here, but the clicast process might have already died
            # from the propagated SIGINT, so we need to catch the exception
            try:
                processObject.stdin.write("clicast-server-shutdown\n")
                processObject.stdin.flush()
                processObject.wait()
            except:
                pass
            clearClicastInstance(enviroPath)
            returnValue = True
        else:
            logMessage(f"  no clicast instance exists for environment: {enviroPath}")
    return returnValue


enviroNameRegex = "-e\s*([^\s]*)"


def getEnviroPathFromCommand(command):
    # TBD in the future we will change the caller to pass in the environment path
    # No error handling because the caller will guarantee that we have a valid command
    match = re.search(enviroNameRegex, command)
    enviroName = match.group(1)
    enviroPath = os.path.join(os.getcwd(), enviroName)

    return enviroPath


def getStandardArgsFromTestObject(testIDObject, quoteParameters):
    returnString = f"-e{testIDObject.enviroName}"
    if testIDObject.unitName != "not-used":
        returnString += f" -u{testIDObject.unitName}"

    # I did not do something clever with the quote insertion
    # to make the code easier to read
    if quoteParameters:
        # when we call clicast from the command line, we need
        # Need to quote the strings because of names that have << >>
        returnString += f' -s"{testIDObject.functionName}"'
        returnString += f' -t"{testIDObject.testName}"'
    else:
        # when we insert commands in the command file we cannot use quotes
        returnString += f" -s{testIDObject.functionName}"
        returnString += f" -t{testIDObject.testName}"

    return returnString


def convertOutput(rawOutput):
    """
    This will convert the raw output and strip the VECTORCAST_DIR warning
    """
    convertedOutput = rawOutput.decode("utf-8", errors="ignore")
    returnText = "Version:" + convertedOutput.split("**Version")[1]
    return returnText


def runClicastCommandWithEcho(commandToRun):
    """
    Similar to runClicastCommand but with real-time echo of output
    """
    stdoutString = ""
    process = subprocess.Popen(
        commandToRun.split(" "), stdout=subprocess.PIPE, text=True
    )
    while process.poll() is None:
        line = process.stdout.readline().rstrip()
        if len(line) > 0:
            stdoutString += line + "\n"
            print(line, flush=True)

    return process.returncode, stdoutString


def runClicastCommandUsingServer(enviroPath, commandToRun):

    # Strip off the first arg which is the clicast.exe
    # TBD in the future we might only get the clicast args without the clicast exe ...
    commandArgString = " ".join(commandToRun.split(" ")[1:])
    return runClicastServerCommand(enviroPath, commandArgString)


def runClicastCommandCommandLine(commandToRun):
    """
    A wrapper for the subprocess.run() function
    """
    try:
        # note: shell=true, requires commandToRun to be a string
        result = subprocess.run(
            commandToRun,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            shell=True,
        )
        returnCode = result.returncode
        rawOutput = result.stdout
    except subprocess.CalledProcessError as error:
        returnCode = error.returncode
        rawOutput = error.stdout

    return returnCode, convertOutput(rawOutput)


def runClicastCommand(enviroPath, commandToRun):
    if pythonUtilities.USE_SERVER:
        return runClicastCommandUsingServer(enviroPath, commandToRun)
    else:
        return runClicastCommandCommandLine(commandToRun)


# TBD TODAY do we need something special for echoToStdout?
def runClicastScriptUsingServer(enviroPath, commandFileName):

    # read commandFile into a list
    with open(commandFileName, "r") as f:
        lines = f.read().splitlines()

    returnText = ""
    for line in lines:
        # for consistency with the non server version, we stop and
        # return the exit code of the first command that fails
        exitCode, commandOutput = runClicastServerCommand(enviroPath, line)
        returnText += commandOutput
        if exitCode != 0:
            break

    return exitCode, returnText


def runClicastScriptCommandLine(commandFileName, echoToStdout):
    """
    The caller should create a correctly formatted clicast script
    and then call this with the name of that script
    """

    # true at the end tells clicast to exit with the exit code of the first
    # command that fails.  If this is set to false, it always returns 0
    commandToRun = f"{pythonUtilities.globalClicastCommand} -lc tools execute {commandFileName} true"

    if echoToStdout:
        returnCode, stdoutString = runClicastCommandWithEcho(commandToRun)
    else:
        returnCode, stdoutString = runClicastCommandCommandLine(commandToRun)

    os.remove(commandFileName)
    return returnCode, stdoutString


def runClicastScript(enviroPath, commandFileName, echoToStdout=False):

    # noServer allows the caller to specify that we should run clicast directly

    if pythonUtilities.USE_SERVER:
        return runClicastScriptUsingServer(enviroPath, commandFileName)
    else:
        return runClicastScriptCommandLine(commandFileName, echoToStdout)


tempEnviroScript = "rebuild.env"
tempTestScript = "rebuild.tst"


def updateScriptsAndRebuild(enviroPath, jsonOptions):
    """
    This does the actual work of updating the scripts
    and invoking the build and load test script commands
    """

    enviroName = os.path.basename(enviroPath)

    # Read the enviro script into a list of strings
    with open(tempEnviroScript, "r") as enviroFile:
        enviroLines = enviroFile.readlines()

    # Re-write the enviro script replacing the value of commands
    # that exist in the jsonOptions
    with open(tempEnviroScript, "w") as enviroFile:
        for line in enviroLines:
            whatToWrite = line
            if line.startswith("ENVIRO.END"):
                # if we have some un-used options then
                # write these before the ENVIRO.END
                for key, value in jsonOptions.items():
                    enviroFile.write(f"{key}: {value}\n")

            elif line.startswith("ENVIRO.") and ":" in line:
                # for all other commands, see if the command matches
                # a command from the jsonOptions dict
                enviroCommand, enviroValue = line.split(":", 1)
                enviroCommand = enviroCommand.strip()
                enviroValue = enviroValue.strip()
                # if so replace the existing value ...
                if enviroCommand in jsonOptions:
                    whatToWrite = f"{enviroCommand}: {jsonOptions[enviroCommand]}\n"
                    jsonOptions.pop(enviroCommand)

            # write the original or updated line
            enviroFile.write(whatToWrite)

    # if we are server mode, terminate any existing process
    terminateClicastProcess(enviroPath)

    # Finally delete and re-build the environment using the updated script
    # and load the existing tests -> which duplicates what enviro rebuild does.
    with open(commandFileName, "w") as commandFile:
        # Improvement needed: vcast bug: 100924
        shutil.rmtree(enviroName)
        # commandFile.write(f"-e{enviroName} enviro delete\n")
        commandFile.write(f"-lc enviro build {tempEnviroScript}\n")
        commandFile.write(f"-e{enviroName} test script run {tempTestScript}\n")

    # there is no benefit to starting a new server process here (if we are server mode)
    # so we call the command line version directly
    returnCodeRebuild, commandOutputRebuild = runClicastScriptCommandLine(
        commandFileName, echoToStdout=(not pythonUtilities.USE_SERVER)
    )

    os.remove(tempEnviroScript)
    os.remove(tempTestScript)

    return returnCodeRebuild, commandOutputRebuild


def rebuildEnvironmentWithUpdates(enviroPath, jsonOptions):
    """
    pathToUse is the full path to the environment directory
    jsonOptions has the new values of ENVIRO.* commands for the enviro script
    e.g.  ENVIRO.COVERAGE_TYPE: Statement

    We overwrite any matching ENVIRO commands with the new values before rebuild
    """

    with cd(os.path.dirname(enviroPath)):
        # first we generate a .env and .tst for the existing environment
        # we do this using a clicast script
        enviroName = os.path.basename(enviroPath)
        with open(commandFileName, "w") as commandFile:
            commandFile.write(
                f"-e{enviroName} enviro script create {tempEnviroScript}\n"
            )
            commandFile.write(f"-e{enviroName} test script create {tempTestScript}\n")
        returnCode, commandOutput = runClicastScript(
            enviroPath, commandFileName, echoToStdout=(not pythonUtilities.USE_SERVER)
        )

        # if the script generation was successful, we update the scripts and rebuild
        if returnCode == 0:
            # now we update the scripts and rebuild the environment
            returnCode, commandOutputRebuild = updateScriptsAndRebuild(
                enviroPath, jsonOptions
            )
            # concatenate the output from both commands for completeness
            commandOutput = f"{commandOutput}\n{commandOutputRebuild.rstrip()}"

    return returnCode, commandOutput


def rebuildEnvironmentUsingClicastReBuild(enviroPath):
    """
    This does a "normal" rebuild environment, when there are no
    edits to be made to the enviro script
    """
    with cd(os.path.dirname(enviroPath)):
        enviroName = os.path.basename(enviroPath)
        commandToRun = (
            f"{pythonUtilities.globalClicastCommand} -lc -e{enviroName} enviro re_build"
        )
        returnCode, commandOutput = runClicastCommandWithEcho(commandToRun)

    return returnCode, commandOutput


# ----------------------------------------------------------------------------------------------------
# Functional Interface to clicast
# ----------------------------------------------------------------------------------------------------


def rebuildEnvironment(enviroPath, jsonOptions):
    """
    Note: rebuild environment cannot use server mode
    since we are deleting and recreating the environment
    """

    if jsonOptions:
        return rebuildEnvironmentWithUpdates(enviroPath, jsonOptions)
    else:
        return rebuildEnvironmentUsingClicastReBuild(enviroPath)


def executeTest(enviroPath, testIDObject):
    # since we are doing a direct call to clicast, we need to quote the parameters
    # separate variable because in the future there will be additional parameters
    shouldQuoteParameters = not pythonUtilities.USE_SERVER
    standardArgs = getStandardArgsFromTestObject(testIDObject, shouldQuoteParameters)
    # we cannot include the execute command in the command script that we use for
    # results because we need the return code from the execute command separately
    commandToRun = (
        f"{pythonUtilities.globalClicastCommand} -lc {standardArgs} execute run"
    )
    executeReturnCode, stdoutText = runClicastCommand(enviroPath, commandToRun)

    # currently clicast returns the same error code for a failed coded test compile or
    # a failed coded test execution.  We need to distinguish between these two cases
    # so we are using this hack until vcast changes the return code for a failed coded test compile
    if testIDObject.functionName == "coded_tests_driver" and executeReturnCode != 0:
        if "TEST RESULT:" not in stdoutText:
            executeReturnCode = errorCodes.codedTestCompileError

    return executeReturnCode, stdoutText


def generateExecutionReport(enviroPath, testIDObject):

    standardArgs = getStandardArgsFromTestObject(testIDObject, False)
    # We build a clicast command script to generate the execution report
    # since we need multiple commands
    with open(commandFileName, "w") as commandFile:
        commandFile.write(
            standardArgs
            + " report custom actual "
            + testIDObject.reportName
            + ".html\n"
        )
        commandFile.write("option VCAST_CUSTOM_REPORT_FORMAT TEXT\n")
        commandFile.write(
            standardArgs + " report custom actual " + testIDObject.reportName + ".txt\n"
        )
        commandFile.write("option VCAST_CUSTOM_REPORT_FORMAT HTML\n")

    # we ignore the exit code and return the stdout
    exitCode, stdOutput = runClicastScript(enviroPath, commandFileName)
    return stdOutput


# TBD TODAY - Is this useful?
if __name__ == "__main__":
    """
    Unit tests, with values hard-coded for now ...
    """
    pythonUtilities.USE_SERVER = True
    pythonUtilities.globalClicastCommand = (
        "/home/Users/jjp/vector/build/vc24/Linux/vc/clicast"
    )

    numberOfCommands = 10

    startTime = time.time()
    for _ in range(numberOfCommands):
        # test runClicastCommand
        commandToRun = f"{pythonUtilities.globalClicastCommand} -lc -eDEMO1 -umanager -sManager::PlaceOrder -tTest1 execute run"
        enviroPath = os.path.join(os.getcwd(), "DEMO1")
        returnCode, stdoutString = runClicastCommand(enviroPath, commandToRun)
        print(stdoutString)
    endTime = time.time()
    print(
        f"elapsed time: {endTime-startTime} seconds for {numberOfCommands} runs of runClicastCommand"
    )

    # delay to allow some measurements to be taken
    print("one process running, waiting 10 seconds")
    time.sleep(10)

    # test runClicastScript
    commandFileName = "testScript.cmd"
    with open(commandFileName, "w") as f:
        for _ in range(numberOfCommands):
            f.write("-lc -eDEMO2 -umanager -sManager::PlaceOrder -tTest1 execute run\n")
    enviroPath = os.path.join(os.getcwd(), "DEMO2")
    returnCode, stdoutString = runClicastScript(enviroPath, commandFileName)
    print(stdoutString)

    # delay to allow some measurements to be taken
    print("two processes running, waiting 10 seconds")
    time.sleep(10)
