import datetime
import sys


# This contains the clicast command that was used to start the data server
globalClicastCommand = ""

# This global is used by all of the moudles to determine if they should
# use the server logic or not.  This is set to True in the main() function
# of vcastDataServer.py
USE_SERVER = False

# Key is the path to the environment, value is the clicast instance for that environment
clicastInstances = {}


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
