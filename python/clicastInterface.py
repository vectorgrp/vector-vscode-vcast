
import os
import re
import subprocess
import sys
import time

"""
This script contains the clicast stuff from vTestInterface.py, moved
here to enable us to prototype clicast server mode.  I've kept the 
interface the same for now, this can be optimized later.
"""


globalClicastCommand = ""
enviroNameRegex = "-e([^\s]*)"
USE_SERVER=False

# Key is the path to the environment, value is the clicast instance for that environment
clicastInstances = {}


logFileHandle = sys.stdout
def logMessage(message):
    """
    This function will send server side messages to the file
    opened by the server, and client side messages to stdout
    """
    logFileHandle.write(message + "\n")
    logFileHandle.flush()


def runClicastServerCommand (enviroPath, commandString):

    """
    Note: we indent the log messages here to make them easier to 
    read in the context of the original server command received
    """

    if enviroPath not in clicastInstances:
        # start clicast in server mode
        logMessage (f"  starting clicast server for environment: {enviroPath}")
        commandArgs = [globalClicastCommand, "-lc", "tools", "server"]
        process = subprocess.Popen(
            commandArgs,
            stdout=subprocess.PIPE,
            stdin=subprocess.PIPE,
            stderr=sys.stdout,
            universal_newlines=True,
        )
        clicastInstances[enviroPath] = process
    else:
        logMessage (f"  using existing clicast instance for: {enviroPath}")

    logMessage (f"    commandString: {commandString}")
    process = clicastInstances[enviroPath]
    process.stdin.write(f"{commandString}\n")
    process.stdin.flush()

    responseLine = ""
    returnText = ""
    while not responseLine.startswith ("clicast-server-command-done"):
        responseLine = process.stdout.readline()
        returnText += responseLine
    statusText = responseLine.split(":")[1].strip()
    return statusText!="SUCCESS", returnText
    

def getEnviroPathFromCommand (command):

    # TBD in the future we will change the caller to pass in the environment path
    # No error handling because the caller will guarantee that we have a valid command
    match = re.search(enviroNameRegex, command)
    enviroName = match.group(1)
    enviroPath = os.path.join (os.getcwd(), enviroName) 

    return enviroPath


def runClicastCommandServer (commandToRun):

    enviroPath = getEnviroPathFromCommand (commandToRun)

    # TBD in the future we will only get the clicast args without the clicast exe ...
    commandArgString = " ".join (commandToRun.split(" ")[1:])
    return runClicastServerCommand (enviroPath, commandArgString)


def runClicastCommandCommandLine (commandToRun):
    """
    A wrapper for the subprocess.run() function
    """
    try:
        # note: shell=true, requires commandToRun to be a string
        result = subprocess.run(
            commandToRun, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, shell=True)
        returnCode = result.returncode
        rawOutput = result.stdout
    except subprocess.CalledProcessError as error:
        returnCode = error.returncode
        rawOutput = error.stdout

    return returnCode, rawOutput.decode("utf-8", errors="ignore")


def runClicastCommand (commandToRun):
    if USE_SERVER:
        return runClicastCommandServer (commandToRun)
    else:
        return runClicastCommandCommandLine (commandToRun)


def runClicastScriptServer (commandFileName):
    
    # read commandFile into a list
    with open (commandFileName, "r") as f:
        lines = f.read().splitlines()

    enviroPath = getEnviroPathFromCommand (lines[0])
    returnText = ""
    for line in lines:
        commandCode, commandOutput = runClicastServerCommand (enviroPath, line)
        returnText += commandOutput

    return 0, returnText


def runClicastScriptCommandLine (commandFileName):
    """
    The caller should create a correctly formatted clicast script
    and then call this with the name of that script
    """

    # false at the end tells clicast to ignore errors in individual commands
    commandToRun = f"{globalClicastCommand} -lc tools execute {commandFileName} false"
    returnCode, stdoutString = runClicastCommand (commandToRun)

    os.remove(commandFileName)
    return returnCode, stdoutString


def runClicastScript (commandFileName):
    if USE_SERVER:
        return runClicastScriptServer (commandFileName)
    else:
        return runClicastScriptCommandLine (commandFileName)


if __name__ == "__main__":
    """
    Unit tests, with values hard-coded for now ...
    """
    USE_SERVER=True
    globalClicastCommand = "/home/Users/jjp/vector/build/vc24/Linux/vc/clicast"
    
    numberOfCommands = 10

    startTime = time.time()
    for i in range(numberOfCommands):
        # test runClicastCommand
        commandToRun = f"{globalClicastCommand} -lc -eDEMO1 -umanager -sManager::PlaceOrder -tTest1 execute run"
        returnCode, stdoutString = runClicastCommand(commandToRun)
        print (stdoutString)
    endTime = time.time()
    print (f"elapsed time: {endTime-startTime} seconds for {numberOfCommands} runs of runClicastCommand")

    # delay to allow some measurements to be taken
    print ("one process running, waiting 10 seconds")
    time.sleep(10)

    # test runClicastScript
    commandFileName = "testScript.cmd"
    with open(commandFileName, "w") as f:
        for i in range (numberOfCommands):
            f.write("-lc -eDEMO2 -umanager -sManager::PlaceOrder -tTest1 execute run\n")
    returnCode, stdoutString = runClicastScript(commandFileName)
    print (stdoutString)

    # delay to allow some measurements to be taken
    print ("two processes running, waiting 10 seconds")
    time.sleep(10)
