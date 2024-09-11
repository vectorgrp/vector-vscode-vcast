"""
//////////////////////////////////////////////////////////////////////////////
this started life as a duplicate of:  dataAPIInterface/testEditorInterface.py
//////////////////////////////////////////////////////////////////////////////
"""

"""
This file provides the interface between the VSCode plugin server
and the VectorCAST environment, using the VectorCAST dataAPI
"""

import argparse
import json
import re
import sys


from tstUtilities import (
    buildChoiceResponse,
    choiceDataType,
    globalOutputLog,
    processTstLine,
    processTstLine,
    processMockDefinition,
)


def main():
    # ------------------------------------------------------
    # Main function, called by the VS Code language server

    print("ACTUAL-DATA")

    # We get here when the user types a "." or ":"

    # argv has the name of the script as arg 1 and then user args
    parser = argparse.ArgumentParser(description="Process some arguments.")

    parser.add_argument('--mode', required=True, help='Mode of operation: choiceList-ct or choiceList-tst')
    parser.add_argument('--enviroName', required=True, help='Path to the environment folder')
    parser.add_argument('--inputLine', required=True, help='Contents of the line from the editor so far')
    parser.add_argument('--unit', help='Unit name (optional)')

    args = parser.parse_args()

    mode = args.mode
    enviroName = args.enviroName
    inputLine = args.inputLine
    unit = args.unit


    if mode == "choiceList-ct":
        if re.match("^\s*\/\/\s*vmock", inputLine):
            choiceData = processMockDefinition(enviroName, inputLine)
        else:
            choiceData = choiceDataType()

    elif mode == "choiceList-tst":
        choiceData = processTstLine(enviroName, inputLine, unit)

    else:
        choiceData = choiceDataType()
        globalOutputLog.append("Invalid mode: " + mode)

    outputDictionary = buildChoiceResponse(choiceData)
    print(json.dumps(outputDictionary, indent=4))

    sys.exit(0)


if __name__ == "__main__":
    main()
