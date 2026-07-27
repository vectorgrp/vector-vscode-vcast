import os
import re
import shutil
import subprocess
import sys
import time
import pathlib

"""
This script contains the clicast stuff tha was previously 
in vTestInterface.py.  It was moved here to give access to the 
VectorCAST environment server.
"""

import pythonUtilities
from pythonUtilities import (
    cleanEnviroPath,
    closeEnvironmentConnection,
    getClicastInstance,
    logMessage,
    monkeypatch_custom_css,
)
from vcastDataServerTypes import errorCodes
from vector.apps.DataAPI.unit_test_api import UnitTestApi
from vector.lib.core.system import cd

# Filename used when we run a clicast command script
commandFileName = "commands.cmd"


def runClicastServerCommand(enviroPath, commandString):
    """
    Note: we indent the log messages here to make them easier to
    read in the context of the original server command received
    """

    # This call will return the processObject or None
    processObject = getClicastInstance(enviroPath)

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


enviroNameRegex = "-e\s*([^\s]*)"


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
    # Iterate the pipe until EOF rather than looping on process.poll(): polling
    # stops as soon as the process exits and drops any output still buffered in
    # the pipe, which truncates the tail of large outputs (e.g. a rebuild that
    # emits thousands of lines and then exits quickly).
    for line in process.stdout:
        line = line.rstrip()
        if len(line) > 0:
            stdoutString += line + "\n"
            print(line, flush=True)

    process.wait()
    return process.returncode, stdoutString


def runClicastCommandUsingServer(enviroPath, commandToRun):

    # Strip off the first arg which is the clicast.exe
    # In the future we might only get the clicast args without the clicast exe ...
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


def runClicastScriptCommandLine(commandFileName, echoToStdout, languageFlag="-lc"):
    """
    The caller should create a correctly formatted clicast script
    and then call this with the name of that script.

    languageFlag sets the language for the "tools execute" session. It defaults
    to "-lc" (C/C++), but must be "-l ada" for Ada environments.
    """

    # true at the end tells clicast to exit with the exit code of the first
    # command that fails.  If this is set to false, it always returns 0
    commandToRun = f"{pythonUtilities.globalClicastCommand} {languageFlag} tools execute {commandFileName} true"

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


def environmentIsAda(enviroPath):
    """
    Returns True if the environment is an Ada environment, using the
    authoritative DataAPI is_ada flag. Falls back to False if the environment
    cannot be opened.
    """
    try:
        with UnitTestApi(enviroPath) as api:
            return bool(getattr(api.environment, "is_ada", False))
    except Exception:
        return False


def adaParentLibOverride(enviroName):
    """
    On rebuild we regenerate the enviro script with "enviro script create".
    For Ada environments VectorCAST re-emits ENVIRO.PARENT_LIB as a bare GPR
    basename (relative to the current directory). But the GPR lives in the Ada
    *source* directory, not the rebuild CWD (unitTests/), so a relative
    reference does not resolve at build time and "enviro build" fails with
    exit code 19.

    The extension's original <enviroName>.env script still records the correct
    ABSOLUTE PARENT_LIB it wrote at create time, so read it back and use that to
    fix up the regenerated script. Returns the absolute PARENT_LIB value, or
    None if it is unavailable (in which case the regenerated value is kept).
    """
    originalEnv = enviroName + ".env"
    if not os.path.isfile(originalEnv):
        return None
    try:
        with open(originalEnv, "r") as originalFile:
            for line in originalFile:
                if line.strip().startswith("ENVIRO.PARENT_LIB"):
                    _, value = line.split(":", 1)
                    value = value.strip()
                    if os.path.isabs(value) and os.path.exists(value):
                        return value
    except Exception:
        pass
    return None


def updateScriptsAndRebuild(enviroPath, jsonOptions, isAda=False):
    """
    This does the actual work of updating the scripts
    and invoking the build and load test script commands
    """

    enviroName = os.path.basename(enviroPath)

    # Ada environments must be rebuilt with "-l ada"; C/C++ use "-lc".
    languageFlag = "-l ada" if isAda else "-lc"

    # For Ada, "enviro script create" loses the absolute PARENT_LIB (GPR) path;
    # recover it from the original env script so the rebuild can find the GPR.
    adaParentLib = adaParentLibOverride(enviroName) if isAda else None

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
                # Ada: restore the absolute GPR path lost by "script create".
                if adaParentLib and enviroCommand == "ENVIRO.PARENT_LIB":
                    whatToWrite = f"ENVIRO.PARENT_LIB: {adaParentLib}\n"
                # if so replace the existing value ...
                elif enviroCommand in jsonOptions:
                    whatToWrite = f"{enviroCommand}: {jsonOptions[enviroCommand]}\n"
                    jsonOptions.pop(enviroCommand)

            # write the original or updated line
            enviroFile.write(whatToWrite)

    # if we are server mode, terminate any existing process
    closeEnvironmentConnection(enviroPath)

    vceName = enviroName + ".vce"
    bakName = enviroName + ".BAK"
    bakVceName = enviroName + ".BAK.vce"

    # clicast "enviro build" refuses to build over an existing environment
    # directory, so the original must be moved aside first.  We rename it to
    # <name>.BAK, so that a failed build can be rolled back without losing the environment. On success the
    # .BAK is left in place for the rebuildEnvironmentCallback (TypeScript) to
    # remove.
    if os.path.isdir(bakName):
        shutil.rmtree(bakName)
    if os.path.exists(bakVceName):
        os.remove(bakVceName)
    os.rename(enviroName, bakName)
    if os.path.exists(vceName):
        os.rename(vceName, bakVceName)

    echoToStdout = not pythonUtilities.USE_SERVER

    # Build the new environment from the updated script.
    with open(commandFileName, "w") as commandFile:
        commandFile.write(f"{languageFlag} enviro build {tempEnviroScript}\n")
    returnCodeRebuild, commandOutputRebuild = runClicastScriptCommandLine(
        commandFileName, echoToStdout=echoToStdout, languageFlag=languageFlag
    )

    if returnCodeRebuild == 0:
        # Build succeeded: load the existing tests back into the new environment.
        with open(commandFileName, "w") as commandFile:
            commandFile.write(f"-e{enviroName} test script run {tempTestScript}\n")
        returnCodeTests, commandOutputTests = runClicastScriptCommandLine(
            commandFileName, echoToStdout=echoToStdout, languageFlag=languageFlag
        )
        commandOutputRebuild = f"{commandOutputRebuild}\n{commandOutputTests.rstrip()}"
        returnCodeRebuild = returnCodeTests
    else:
        # Build failed: discard the partial build and restore the saved
        # environment.  We must NOT run the test script against the restored
        # environment, because its tests are still present and re-running the
        # script would duplicate every test case.
        if os.path.isdir(enviroName):
            shutil.rmtree(enviroName)
        if os.path.exists(vceName):
            os.remove(vceName)
        os.rename(bakName, enviroName)
        if os.path.exists(bakVceName):
            os.rename(bakVceName, vceName)
        commandOutputRebuild = (
            f"{commandOutputRebuild}\n"
            f"Environment re-build failed; restored the previous environment "
            f"'{enviroName}' from backup."
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
        # Determine the source language while the environment still exists, so
        # that we can rebuild it with the correct clicast language flag (Ada
        # vs C/C++).
        isAda = environmentIsAda(enviroPath)

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
                enviroPath, jsonOptions, isAda
            )
            # concatenate the output from both commands for completeness
            commandOutput = f"{commandOutput}\n{commandOutputRebuild.rstrip()}"

    return returnCode, commandOutput


# ----------------------------------------------------------------------------------------------------
# Functional Interface to clicast
# ----------------------------------------------------------------------------------------------------


def rebuildEnvironment(enviroPath, jsonOptions):
    """
    Note: rebuild environment cannot use server mode
    since we are deleting and recreating the environment.

    The current build settings (e.g. coverageKind) are always passed in as
    jsonOptions, so the rebuild goes through the build-from-script path which
    can incorporate those changes.  A plain "clicast enviro re_build" is not
    used because it rebuilds from the environment's stored configuration and
    would ignore the updated options.
    """

    return rebuildEnvironmentWithUpdates(enviroPath, jsonOptions)


def executeTest(enviroPath, testIDObject):
    # since we are doing a direct call to clicast, we need to quote the parameters
    # separate variable because in the future there will be additional parameters
    shouldQuoteParameters = not pythonUtilities.USE_SERVER
    standardArgs = getStandardArgsFromTestObject(testIDObject, shouldQuoteParameters)
    # Ada environments must be driven with "-l ada"; C/C++ use "-lc". Using the
    # wrong language flag is inconsistent (and bites other clicast commands such
    # as "enviro build" - see updateScriptsAndRebuild).
    languageFlag = "-l ada" if environmentIsAda(enviroPath) else "-lc"
    # we cannot include the execute command in the command script that we use for
    # results because we need the return code from the execute command separately
    commandToRun = f"{pythonUtilities.globalClicastCommand} {languageFlag} {standardArgs} execute run"
    executeReturnCode, stdoutText = runClicastCommand(enviroPath, commandToRun)

    # currently clicast returns the same error code for a failed coded test compile or
    # a failed coded test execution.  We need to distinguish between these two cases
    # so we are using this hack until vcast changes the return code for a failed coded test compile
    if testIDObject.functionName == "coded_tests_driver" and executeReturnCode != 0:
        if "TEST RESULT:" not in stdoutText:
            executeReturnCode = errorCodes.codedTestCompileError

    return executeReturnCode, stdoutText


def generate_report(testObject):
    """
    Generates the our custom report for the test case execution data

    File gets written to output
    """

    # Calculate the location of our custom folder
    source_root = pathlib.Path(__file__).parent.resolve()
    custom_dir = source_root / "custom"

    # What's the path to our custom CSS?
    custom_css = custom_dir / "vscode.css"

    # Patch get_option to use our CSS without setting the CFG option
    monkeypatch_custom_css(custom_css)

    test_found = False

    # Open-up the unit test API
    with UnitTestApi(testObject.enviroName) as api:
        for test_case in api.TestCase.all():
            # Combined condition to find the correct test case
            if (
                (
                    test_case.unit_display_name == testObject.unitName
                    or testObject.unitName == "not-used"
                )
                and test_case.function_display_name == testObject.functionName
                and test_case.name == testObject.testName
            ):
                test_found = True

                # Generate our report
                api.report(
                    report_type="per_test_case_report",
                    formats=["HTML"],
                    output_file=testObject.reportName,
                    customization_dir=str(custom_dir),
                    testcases=[test_case],
                )
                break

    # Report an error if our test case is not found
    if not test_found:
        raise RuntimeError(
            f"Could not find test case with Unit: {testObject.unitName}, Function: {testObject.functionName}, Test: {testObject.testName}"
        )
