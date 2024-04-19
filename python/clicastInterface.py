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

from vTestUtilities import logMessage

from vector.lib.core.system import cd

commandFileName = "commands.cmd"

globalClicastCommand = ""
USE_SERVER = False

# Key is the path to the environment, value is the clicast instance for that environment
clicastInstances = {}


def runClicastServerCommand(enviroPath, commandString):
    """
    Note: we indent the log messages here to make them easier to
    read in the context of the original server command received
    """

    if enviroPath in clicastInstances and clicastInstances[enviroPath].poll() == None:
        logMessage(f"  using existing clicast instance for: {enviroPath}")

    else:
        # this is in case the clicast server crashes ...   
        if enviroPath in clicastInstances:
            logMessage(f"  previous clicast server seems to have died ...")

        logMessage(f"  starting clicast server for environment: {enviroPath}")
        commandArgs = [globalClicastCommand, "-lc", "tools", "server"]
        CWD = os.path.dirname(enviroPath)
        process = subprocess.Popen(
            commandArgs,
            stdout=subprocess.PIPE,
            stdin=subprocess.PIPE,
            stderr=sys.stdout,
            universal_newlines=True,
            cwd=CWD,
        )
        clicastInstances[enviroPath] = process


    logMessage(f"    commandString: {commandString}")
    process = clicastInstances[enviroPath]
    process.stdin.write(f"{commandString}\n")
    process.stdin.flush()

    responseLine = ""
    returnText = ""
    
    # The clicast server emits a line like this to mark the end of a command:
    #   clicast-server-command-done:COMMAND_NOT_ALLOWED | 8
    # Between the colon and the command is the status enum, and the 
    # number after the | is the 'pos of the enum which is the normal
    # exit code for a clicast command.
    while not responseLine.startswith("clicast-server-command-done"):
        returnText += responseLine
        responseLine = process.stdout.readline()

    errorCode = responseLine.split("|")[1].strip()
    logMessage (f"    server return code: {errorCode}")
    if errorCode != "0":
        logMessage (f"    server return text: {returnText}")

    return errorCode, returnText


def terminateClicastProcess(enviroPath):
    """
    This function will terminate any clicast process that exists for enviroPath
    It is used before things like delete and re-build environment, since we need
    to delete the environment directory, and the running process will have it locked
    if we are in server mode
    """
    if USE_SERVER and enviroPath in clicastInstances:
        logMessage(f"  terminating clicast instance for environment: {enviroPath}")
        process = clicastInstances[enviroPath]
        process.stdin.write("clicast-server-shutdown\n")
        process.stdin.flush()
        process.wait()
        del clicastInstances[enviroPath]


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


def runClicastCommandUsingServer(commandToRun):

    enviroPath = getEnviroPathFromCommand(commandToRun)

    # Strip off the first arg which is the clicst.exe
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

    return returnCode, rawOutput.decode("utf-8", errors="ignore")


def runClicastCommand(commandToRun, noServer=False):
    if USE_SERVER and not noServer:
        return runClicastCommandUsingServer(commandToRun)
    else:
        return runClicastCommandCommandLine(commandToRun)


# TBD TODAY do we need something special for echoToStdout?
def runClicastScriptUsingServer(commandFileName, echoToStdout):

    # read commandFile into a list
    with open(commandFileName, "r") as f:
        lines = f.read().splitlines()

    enviroPath = getEnviroPathFromCommand(lines[0])
    returnText = ""
    for line in lines:
        commandCode, commandOutput = runClicastServerCommand(enviroPath, line)
        returnText += commandOutput

    return 0, returnText


def runClicastScriptCommandLine(commandFileName, echoToStdout):
    """
    The caller should create a correctly formatted clicast script
    and then call this with the name of that script
    """

    # false at the end tells clicast to ignore errors in individual commands
    commandToRun = f"{globalClicastCommand} -lc tools execute {commandFileName} false"

    if echoToStdout:
        returnCode, stdoutString = runClicastCommandWithEcho(commandToRun)
    else:
        returnCode, stdoutString = runClicastCommand(commandToRun)

    os.remove(commandFileName)
    return returnCode, stdoutString


def runClicastScript(commandFileName, echoToStdout=False, noServer=False):

    # noServer allows the caller to specify that we should run clicast directly

    if USE_SERVER and not noServer:
        return runClicastScriptUsingServer(commandFileName, echoToStdout)
    else:
        return runClicastScriptCommandLine(commandFileName, echoToStdout)


def updateEnvironment(enviroPath, jsonOptions):
    """
    pathToUse is the full path to the environment directory
    jsonOptions has the new values of ENVIRO.* commands for the enviro script
    e.g.  ENVIRO.COVERAGE_TYPE: Statement

    We overwrite any matching ENVIRO commands with the new values befoe rebuild
    """

    tempEnviroScript = "rebuild.env"
    tempTestScript = "rebuild.tst"

    with cd(os.path.dirname(enviroPath)):

        # first we generate a .env and .tst for the existing environment
        # we do this using a clicast script
        enviroName = os.path.basename(enviroPath)
        with open(commandFileName, "w") as commandFile:
            commandFile.write(
                f"-e{enviroName} enviro script create {tempEnviroScript}\n"
            )
            commandFile.write(f"-e{enviroName} test script create {tempTestScript}\n")
        exitCode, stdOutput = runClicastScript(
            commandFileName, echoToStdout=True, noServer=True
        )

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

                # write the orignal or updated line
                enviroFile.write(whatToWrite)

        # Finally delete and re-build the environment using the updated script
        # and load the existing tests -> which duplicates what enviro rebuild does.
        with open(commandFileName, "w") as commandFile:
            # Improvement needed: vcast bug: 100924
            shutil.rmtree(enviroName)
            # commandFile.write(f"-e{enviroName} enviro delete\n")
            commandFile.write(f"-lc enviro build {tempEnviroScript}\n")
            commandFile.write(f"-e{enviroName} test script run {tempTestScript}\n")
        exitCode, stdOutput = runClicastScript(
            commandFileName, echoToStdout=True, noServer=True
        )

        os.remove(tempEnviroScript)
        os.remove(tempTestScript)


def rebuildEnvironmentUsingClicastReBuild(enviroPath):
    """
    This dowes a "normal" rebuild environment, when there are no
    edits to be made to the enviro script
    """
    with cd(os.path.dirname(enviroPath)):
        enviroName = os.path.basename(enviroPath)
        commandToRun = f"{globalClicastCommand} -lc -e{enviroName} enviro re_build"
        returnCode, commandOutput = runClicastCommandWithEcho(commandToRun)


# ----------------------------------------------------------------------------------------------------
# Functional Interface to clicast
# ----------------------------------------------------------------------------------------------------


def rebuildEnvironment(enviroPath, jsonOptions):
    """
    Note: rebuild environment cannot use server mode
    since we are deleteing and recreating the environment
    """

    if jsonOptions:
        updateEnvironment(enviroPath, jsonOptions)
    else:
        rebuildEnvironmentUsingClicastReBuild(enviroPath)


def executeTest(testIDObject):

    # since we are doing a direct call to clicast, we need to quote the parameters
    # separate variable because in the future there will be additional parameters
    shouldQuoteParameters = True and not USE_SERVER
    standardArgs = getStandardArgsFromTestObject(testIDObject, shouldQuoteParameters)
    # we cannot include the execute command in the command script that we use for
    # results because we need the return code from the execute command separately
    commandToRun = f"{globalClicastCommand} -lc {standardArgs} execute run"
    executeReturnCode, stdoutText = runClicastCommand(commandToRun)

    # currently clicast returns the same error code for a failed coded test compile or
    # a failed coded test execution.  We need to distinguish between these two cases
    # so we are using this hack until vcast changes the return code for a failed coded test compile
    if testIDObject.functionName == "coded_tests_driver" and executeReturnCode != 0:
        if "TEST RESULT:" not in stdoutText:
            executeReturnCode = 997

    return executeReturnCode, stdoutText


def generateExecutionReport(testIDObject):

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

    # we ignore the exit code and return the stdoutput
    exitCode, stdOutput = runClicastScript(commandFileName)
    return stdOutput


if __name__ == "__main__":
    """
    Unit tests, with values hard-coded for now ...
    """
    USE_SERVER = True
    globalClicastCommand = "/home/Users/jjp/vector/build/vc24/Linux/vc/clicast"

    numberOfCommands = 10

    startTime = time.time()
    for i in range(numberOfCommands):
        # test runClicastCommand
        commandToRun = f"{globalClicastCommand} -lc -eDEMO1 -umanager -sManager::PlaceOrder -tTest1 execute run"
        returnCode, stdoutString = runClicastCommand(commandToRun)
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
        for i in range(numberOfCommands):
            f.write("-lc -eDEMO2 -umanager -sManager::PlaceOrder -tTest1 execute run\n")
    returnCode, stdoutString = runClicastScript(commandFileName)
    print(stdoutString)

    # delay to allow some measurements to be taken
    print("two processes running, waiting 10 seconds")
    time.sleep(10)
