import argparse
import copy
import json
import os
import sys
import signal
import traceback

import vcastDataServerTypes
from vcastDataServerTypes import commandType, errorCodes


# flask was added to vpython for vc24sp4
from flask import Flask, request

app = Flask(__name__)

import clicastInterface
import testEditorInterface
import tstUtilities
import vTestInterface
import pythonUtilities
from pythonUtilities import logFileHandle, logMessage, logPrefix


@app.route("/ping")
def ping():
    logMessage(f"{logPrefix()} received ping request, responding 'alive'")
    # we return the clicast path since the client needs this
    return {"text": f"clicast-path: {pythonUtilities.globalClicastCommand}"}


@app.route("/shutdown")
def shutdown():
    logMessage(f"{logPrefix()} received shutdown request ...")
    # terminate all of the clicast processes
    # Need a copy of the keys because we are modifying the dictionary
    # while looping over it would cause an error
    keyList = list(pythonUtilities.clicastInstances.keys())
    for enviroPath in keyList:
        logMessage(f"  terminating clicast process for: {enviroPath}")
        clicastInterface.closeEnvironmentConnection(enviroPath)

    # TBD: is there an app.shutdown() call to do this?
    logMessage("  vcastDataServer is exiting ...")
    sys.exit(0)


@app.route("/runcommand")
def runcommand():
    """
    This function does the work of translating the clientRequest object into a call
    to the vTestInterface module and then sending the response object back to the client
    """

    # Is it possible to receive a python class directly
    clientRequestText = request.args.get("request")
    clientRequest = decodeRequest(clientRequestText)

    try:
        logMessage(
            f"\n{logPrefix()} received client request: {clientRequest.command} for {clientRequest.path}"
        )
        logMessage(f"  clicastInstances: {pythonUtilities.clicastInstances.keys()}")
        exitCode = 0
        if clientRequest.command == commandType.closeConnection:

            returnValue = clicastInterface.closeEnvironmentConnection(
                clientRequest.path
            )
            returnData = {
                "status": returnValue,
                "newlist": list(pythonUtilities.clicastInstances.keys()),
            }
            logMessage(f"  clicastInstances: {pythonUtilities.clicastInstances.keys()}")

        elif clientRequest.command == commandType.choiceListTst:

            # because we are not restarting, we need to clear the global output log
            testEditorInterface.globalOutputLog.clear()

            choiceData = testEditorInterface.processTstLine(
                clientRequest.path, clientRequest.options
            )
            returnData = tstUtilities.buildChoiceResponse(choiceData)
            logMessage(f"  line received: '{clientRequest.options}'")
            logMessage(
                "  list returned:\n     " + "\n     ".join(returnData["choiceList"])
            )

        elif clientRequest.command == commandType.choiceListCT:

            # because we are not restarting, we need to clear the global output log
            testEditorInterface.globalOutputLog.clear()

            choiceData = testEditorInterface.processMockDefinition(
                clientRequest.path, clientRequest.options
            )
            returnData = tstUtilities.buildChoiceResponse(choiceData)
            logMessage(f"  line received: '{clientRequest.options}'")

            # the return data for the vmock implementation is really long
            # so we show the first line, otherwise we show the list
            if len(returnData["choiceList"]) == 1:
                # we need to strip off the new line chars as the beginning
                logMessage(
                    "  returned: " + returnData["choiceList"][0].strip().split("\n")[0]
                )
            else:
                logMessage(
                    "  list returned:\n     " + "\n     ".join(returnData["choiceList"])
                )

        elif clientRequest.command == commandType.runClicastCommand:

            exitCode, returnData = clicastInterface.runClicastServerCommand(
                clientRequest.path, clientRequest.options
            )

        elif clientRequest.command in vTestInterface.modeChoices:

            # Note: globalClicastCommand is initialized in the server
            # main() based on the vpython used to start the server
            exitCode, returnData = vTestInterface.processCommand(
                clientRequest.command,
                pythonUtilities.globalClicastCommand,
                clientRequest.path,
                clientRequest.test,
                clientRequest.options,
            )

        elif clientRequest.command == "crash-me":
            # this is for unit testing only to force a stack trace
            raise Exception("crash-me command received")

        elif clientRequest.command == "bad-request-format":
            errorMessage = f"client request was improperly formatted, ignoring: '{clientRequestText}'"
            logMessage(f"  ERROR: {errorMessage}")
            exitCode = errorCodes.internalServerError
            returnData = {"error": [errorMessage]}

        else:
            errorMessage = f"server does not support command: '{clientRequest.command}'"
            logMessage(f"  ERROR: {errorMessage}")
            exitCode = errorCodes.internalServerError
            returnData = {"error": [errorMessage]}

    except Exception as error:
        # if anything goes wrong send the stack trace back to the client
        errorMessage = "internal server error"
        logMessage(f"  ERROR: {errorMessage}")
        errorTextToReturn = [errorMessage]
        errorTextToReturn.extend(traceback.format_exc().split("\n"))
        exitCode = errorCodes.internalServerError
        returnData = {"error": errorTextToReturn}

    return {"exitCode": exitCode, "data": returnData}


def decodeRequest(requestString):

    clientRequest = None
    try:
        requestDictionary = json.loads(requestString)
        clientRequest = vcastDataServerTypes.clientRequest.fromDict(requestDictionary)
    except KeyboardInterrupt:
        raise
    except:
        clientRequest = vcastDataServerTypes.clientRequest("bad-request-format")

    return clientRequest


def setupArgs():
    parser = argparse.ArgumentParser(description="VectorCAST Data Server")
    parser.add_argument(
        "--port", help=f"Server port number (default={vcastDataServerTypes.PORT})"
    )
    return parser


def serverSignalHandler(signum, frame):
    logMessage(f"Server caught signal {signum}")
    shutdown()


def main():
    """
    This is the enviro data server that allows the VS Code Test Explorer
    to interact with the VectorCAST environment.
    """

    # force server mode on
    pythonUtilities.USE_SERVER = True

    # set the global clicast command
    # we are running under vpython so we use that to find the path to clicast
    vcastInstallation = os.path.dirname(sys.executable)
    pythonUtilities.globalClicastCommand = os.path.join(vcastInstallation, "clicast")

    argParser = setupArgs()
    args, _ = argParser.parse_known_args()

    # process port arg if it exists
    vcastDataServerTypes.processPortArg(args)

    # By registering this signal handler we can
    # allow ctrl-c to shutdown the server gracefully
    signal.signal(signal.SIGTERM, serverSignalHandler)
    signal.signal(signal.SIGINT, serverSignalHandler)

    if sys.platform == "win32":
        signal.signal(signal.SIGBREAK, serverSignalHandler)
    else:
        # Explicitly ignore signal.SIGPIPE
        signal.signal(signal.SIGPIPE, signal.SIG_IGN)

    # start the server
    with open("vcastDataServer.log", "w", buffering=1) as pythonUtilities.logFileHandle:
        print(
            f" * vcastDataServer is starting on {vcastDataServerTypes.HOST}:{vcastDataServerTypes.PORT} ..."
        )
        logMessage(
            f"{logPrefix()} using clicast command: {pythonUtilities.globalClicastCommand}\n"
        )
        app.run(vcastDataServerTypes.HOST, vcastDataServerTypes.PORT, threaded=False)


if __name__ == "__main__":
    try:
        main()
        sys.exit(0)

    # allow ctr-c to stop program without messages
    except KeyboardInterrupt:
        shutdown()

    except Exception as err:
        print(Exception, err)
        print(traceback.format_exc())
        print(" ")
        sys.exit(1)
