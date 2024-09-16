import datetime
import os
import subprocess
import sys


# This contains the clicast command that was used to start the data server
globalClicastCommand = ""

# This global is used by all of the moudles to determine if they should
# use the server logic or not.  This is set to True in the main() function
# of vcastDataServer.py
USE_SERVER = False

# Key is the path to the environment, value is the process object
# for the clicast instance for that environment
clicastInstances = {}


def setClicastInstance(enviroPath, processObject):
    """
    This function will set the clicast instance for the given environment
    """
    enviroPath = cleanEnviroPath(enviroPath)
    clicastInstances[enviroPath] = processObject


def removeClicastInstance(enviroPath):
    """
    This function will remove the clicast instance for the given environment
    This should be called AFTER the process has been terminated
    """
    enviroPath = cleanEnviroPath(enviroPath)
    if enviroPath in clicastInstances:
        del clicastInstances[enviroPath]


def startNewClicastInstance(enviroPath):
    """
    This function will start a new clicast instance and check
    that it initializes correctly.  If it does we will return the
    process object, if not we will return None
    """

    commandArgs = [globalClicastCommand, "-lc", "tools", "server"]
    CWD = os.path.dirname(enviroPath)
    processObject = subprocess.Popen(
        commandArgs,
        stdout=subprocess.PIPE,
        stdin=subprocess.PIPE,
        stderr=sys.stdout,
        universal_newlines=True,
        cwd=CWD,
    )

    # A valid clicast server start emits: "clicast-server-started"
    # so we check for that, or we wait for the process to terminate
    # which a non-server clicast version will do.
    # Note that this is a failsafe because we should never get
    # here if the clicast is not server capable.
    while True:
        responseLine = processObject.stdout.readline()
        if responseLine.startswith("clicast-server-started"):
            # server started ok, break and return the process object
            clicastInstanceRunning = True
            break
        elif processObject.poll() is not None:
            # something went wrong, break and return None
            clicastInstanceRunning = False
            processObject = None
            break

    if clicastInstanceRunning:
        setClicastInstance(enviroPath, processObject)
        logMessage(
            f"  started clicast instance [{processObject.pid}] for environment: {enviroPath}"
        )
    else:
        logMessage(f"  could not start clicast instance for environment: {enviroPath}")
        logMessage(f"  using command: {' '.join (commandArgs)}")

    return processObject


def getExistingClicastInstance(enviroPath):
    """
    This function will return the clicast instance for the given environment
    or None if the environment does not have an instance, or if the process is not running
    """

    whatToReturn = None
    # ensure a consistent key for the clicastInstances dictionary
    enviroPath = cleanEnviroPath(enviroPath)
    if enviroPath in clicastInstances and clicastInstances[enviroPath].poll() == None:
        logMessage(
            f"  using existing clicast instance [{clicastInstances[enviroPath].pid}] for: {enviroPath} "
        )
        whatToReturn = clicastInstances[enviroPath]

    return whatToReturn


def getClicastInstance(enviroPath):
    """
    This function will return the clicast instance for the given environment
    If there is not an existing instance, a new clicast instance will be started.
    """
    clicastInstance = getExistingClicastInstance(enviroPath)
    if clicastInstance == None:
        clicastInstance = startNewClicastInstance(enviroPath)
    return clicastInstance


def closeEnvironmentConnection(enviroPath):
    """
    This function will terminate any clicast process that exists for enviroPath
    It is used before things like delete and re-build environment, since we need
    to delete the environment directory, and the running process will have it locked
    If we are in server mode, we return True if we terminated a process, False otherwise
    """

    returnValue = False
    if USE_SERVER:
        processObject = getExistingClicastInstance(enviroPath)
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
            # This simply removes the processObject from the dictionary
            removeClicastInstance(enviroPath)
            returnValue = True
        else:
            logMessage(f"  no clicast instance exists for environment: {enviroPath}")

    return returnValue


def cleanEnviroPath(enviroPath):
    """
    This function is used to clean up the environment path to make it usable as
    a consistent dictionary key.  We force the drive lever to lower case
    and we replace backslashes with forward slashes.
    """
    returnPath = enviroPath.replace("\\", "/")
    if returnPath[1] == ":":
        returnPath = returnPath[0].lower() + returnPath[1:]
    return returnPath


def logPrefix():
    """
    This function returns a string that can be used to prefix log message
    with the tool name and time tag
    """
    return f"vcastDataServer {datetime.datetime.now().strftime('%d.%b %Y %H:%M:%S')}:"


logFileHandle = sys.stdout


def logMessage(message):
    """
    This function will send server side messages to the file
    opened by the server, and client side messages to stdout
    """
    logFileHandle.write(message + "\n")
    logFileHandle.flush()
