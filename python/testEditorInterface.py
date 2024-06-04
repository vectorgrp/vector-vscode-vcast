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


from tstUtilities import choiceDataType, processTstLine, processVMockLine
from tstUtilities import globalOutputLog


def main():
    # ------------------------------------------------------
    # Main function, called by the VS Code language server
    # This main can either service one request directly or start the
    # socket based server to field socket based requests

    # We get here when the user types a "." or ":"

    mode = sys.argv[1]
    if mode == "choiceList":
        # This is option will process one input line and
        # return one set of choices, using stdin/stdout for communication

        enviroName = sys.argv[2]

        # This arg is the contents of the line from the editor, up to the . or :
        inputLine = sys.argv[3]

        # if the line starts with "void vmock" then we are processing a VMock line
        if re.match("^\s*void\s+vmock", inputLine):
            choiceData = processVMockLine(enviroName, inputLine)
        else:
            choiceData = processTstLine(enviroName, inputLine)

    else:
        choiceData = choiceDataType()
        globalOutputLog.append("Invalid mode: " + mode)

    outputDictionary = dict()
    outputDictionary["choiceKind"] = choiceData.choiceKind
    outputDictionary["choiceList"] = choiceData.choiceList
    outputDictionary["messages"] = globalOutputLog

    # See the comment in: runPythonScript()
    print("ACTUAL-DATA")
    print(json.dumps(outputDictionary, indent=4))

    sys.exit(0)


if __name__ == "__main__":
    main()
