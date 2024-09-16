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
import os


from tstUtilities import (
    buildChoiceResponse,
    choiceDataType,
    globalOutputLog,
    processTstLine,
    processTstLine,
    processMockDefinition,
)

# Available modes
modeChoices = ["choiceList-ct", "choiceList-tst"]

def setupArgs():
    """
    Add Command Line Args
    """
    parser = argparse.ArgumentParser(description="VectorCAST Test Editor Interface")

    parser.add_argument(
        "--mode",
        choices=modeChoices,
        required=True,
        help="Test Editor Mode: choiceList-ct or choiceList-tst",
    )

    parser.add_argument(
        "--enviroName",
        required=True,
        help="Path to the environment directory or cbt file"
    )

    parser.add_argument(
        "--inputLine",
        required=True,
        help="Contents of the line from the editor so far"
    )

    parser.add_argument(
        "--unit",
        help="Unit name (optional)"
    )

    return parser

def main():
    # ------------------------------------------------------
    # Main function, called by the VS Code language server

    print("ACTUAL-DATA")

    # We get here when the user types a "." or ":"

    # argv has the name of the script as arg 1 and then user args
    argParser = setupArgs()
    args, restOfArgs = argParser.parse_known_args()
    pathToUse = os.path.abspath(args.enviroName)

    if args.mode == "choiceList-ct":
        if re.match("^\s*\/\/\s*vmock", args.inputLine):
            choiceData = processMockDefinition(pathToUse, args.inputLine)
        else:
            choiceData = choiceDataType()

    elif args.mode == "choiceList-tst":
        choiceData = processTstLine(pathToUse, args.inputLine, args.unit)
    else:
        choiceData = choiceDataType()
        globalOutputLog.append("Invalid mode: " + args.mode)

    outputDictionary = buildChoiceResponse(choiceData)
    print(json.dumps(outputDictionary, indent=4))

    sys.exit(0)


if __name__ == "__main__":
    main()
