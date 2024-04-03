import os
import re
import shutil
import subprocess
import sys
import time

from vector.lib.core.system import cd


commandFileName = "commands.cmd"
globalClicastCommand = ""


enviroNameRegex = "-e([^\s]*)"


def getEnviroPathFromCommand(command):

    # TBD in the future we will change the caller to pass in the environment path
    # No error handling because the caller will guarantee that we have a valid command
    match = re.search(enviroNameRegex, command)
    enviroName = match.group(1)
    enviroPath = os.path.join(os.getcwd(), enviroName)

    return enviroPath


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
# ----------------------------------------------------------------------------------------------------


def rebuildEnvironment(enviroPath, jsonOptions):

    if jsonOptions:
        updateEnvironment(enviroPath, jsonOptions)
    else:
        rebuildEnvironmentUsingClicastReBuild(enviroPath)
