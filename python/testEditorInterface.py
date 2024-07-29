"""
//////////////////////////////////////////////////////////////////////////////
this started life as a duplicate of:  dataAPIInterface/testEditorInterface.py
//////////////////////////////////////////////////////////////////////////////
"""

"""
This file provides the interface between the VSCode plugin server
and the VectorCAST environment, using the VectorCAST dataAPI
"""

import json
import re
import sys


from tstUtilities import (
    choiceDataType,
    processTstLine,
    processMockDefinition,
    processVMockSession,
)
from tstUtilities import globalOutputLog


def main():
    # ------------------------------------------------------
    # Main function, called by the VS Code language server
    # This main can either service one request directly or start the
    # socket based server to field socket based requests

    # See the comment in: runPythonScript()
    print("ACTUAL-DATA")

    # We get here when the user types a "." or ":"

    # argv has the name of the script as arg 1 and then user args
    if len(sys.argv) == 4:
        # What to do choiceList-ct or choiceList-tst
        mode = sys.argv[1]

        # Path to the environment folder
        enviroName = sys.argv[2]

        # Contents of the line from the editor so far
        inputLine = sys.argv[3]

        if mode == "choiceList-ct":
            # if the line starts with "void vmock" then we are processing vmock definition
            if re.match("^\s*\/\/\s*vmock", inputLine):
                choiceData = processMockDefinition(enviroName, inputLine)

            # of if the line starts with auto vmock_session =
            elif re.match("^\s*auto\s+vmock_session\s*=", inputLine):
                choiceData = processVMockSession(enviroName, inputLine)

            else:
                # noting to be done
                choiceData = choiceDataType()

        elif mode == "choiceList-tst":
            choiceData = processTstLine(enviroName, inputLine)

        else:
            choiceData = choiceDataType()
            globalOutputLog.append("Invalid mode: " + mode)

    else:
        choiceData = choiceDataType()
        # first arg is the name of the script, so we subtract 1
        globalOutputLog.append(
            f"Invalid number of arguments: {len(sys.argv)-1}, 3 expected"
        )

    outputDictionary = dict()
    outputDictionary["choiceKind"] = choiceData.choiceKind
    outputDictionary["choiceList"] = choiceData.choiceList
    outputDictionary["extraText"] = choiceData.extraText
    outputDictionary["messages"] = globalOutputLog

    print(json.dumps(outputDictionary, indent=4))

    sys.exit(0)


if __name__ == "__main__":
    main()
