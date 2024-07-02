import os
import re
import shutil
import subprocess
import sys
import time

from vector.lib.core.system import cd


commandFileName = "commands.cmd"
globalClicastCommand = ""


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


def convertOutput (rawOutput):
    """
    This will convert the raw output and strip the VECTORCAST_DIR warning
    """
    convertedOutput = rawOutput.decode("utf-8", errors="ignore")
    returnText = "Version:" + convertedOutput.split("**Version")[1]
    return returnText


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


def runClicastCommand(commandToRun):
    # In preperation for server mode ...
    return runClicastCommandCommandLine(commandToRun)


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


def runClicastScript(commandFileName, echoToStdout=False):
    # In preperation for server mode ...
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
        exitCode, stdOutput = runClicastScript(commandFileName, echoToStdout=True)

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
        exitCode, stdOutput = runClicastScript(commandFileName, echoToStdout=True)

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
    if jsonOptions:
        updateEnvironment(enviroPath, jsonOptions)
    else:
        rebuildEnvironmentUsingClicastReBuild(enviroPath)


codeTestCompileErrorCode = 98


def executeTest(testIDObject):
    # since we are doing a direct call to clicast, we need to quote the parameters
    # separate variable because in the future there will be additional parameters
    shouldQuoteParameters = True
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
            executeReturnCode = codeTestCompileErrorCode

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
