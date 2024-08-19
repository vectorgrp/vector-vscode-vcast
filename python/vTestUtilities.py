import datetime
import sys


def logPrefix ():
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