import datetime
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


# Key is the path to the environment, value is the process object
# for the clicast instance for that environment
unitAPIs = {}


def setClicastInstance(enviroPath, processObject):
    """
    This function will set the clicast instance for the given environment
    """
    # ensure a consistent key for the clicastInstances dictionary
    enviroPath = cleanEnviroPath(enviroPath)
    clicastInstances[enviroPath] = processObject
    logMessage(
        f"  started clicast instance [{processObject.pid}] for environment: {enviroPath}"
    )


def getClicastInstance(enviroPath):
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

    elif enviroPath in clicastInstances:
        # An old instance might exist if the server crashed, so clean that up
        if enviroPath in clicastInstances:
            logMessage(f"  previous clicast instance seems to have died ...")
        del clicastInstances[enviroPath]

    return whatToReturn


def clearClicastInstance(enviroPath):
    enviroPath = cleanEnviroPath(enviroPath)
    del clicastInstances[enviroPath]


def cleanEnviroPath(enviroPath):
    """
    This function is used to clean up the environment path
    to make it usable as a consistent dictionary key
    """
    returnPath = enviroPath.replace("\\", "/")
    if returnPath[2] == ":":
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
