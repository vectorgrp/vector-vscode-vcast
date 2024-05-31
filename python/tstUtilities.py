"""
//////////////////////////////////////////////////////////////////////////////
this started life as a duplicate of:  dataAPIInterface/tstUtilities.py
//////////////////////////////////////////////////////////////////////////////
"""

from enum import Enum
import re
import traceback

from vector.apps.DataAPI.unit_test_api import UnitTestApi
from vector.apps.DataAPI.unit_test_models import Function, Global

globalOutputLog = list()


def getNameListFromObjectList(objectList):
    """
    This will take a list of dataAPI objects and return
    a list of names ... note all objects have name attributes
    """
    returnList = list()
    for object in objectList:
        if isinstance(object, Function):
            # vcast_name has the overloaded name if needed.
            returnList.append(object.vcast_name)
        else:
            returnList.append(object.name)

    return returnList


def getNameListFromItemList(paramOrObjectList):
    """
    This gets called for params and global objects
    This will create a list of name@type items
    """
    returnList = list()
    for object in paramOrObjectList:
        if isinstance(object, Global):
            # Improvement needed: need to handle class instance objects here
            listItem = object.name + "@" + additionalTypeInfo(object.type)
        else:
            typeInfo = additionalTypeInfo(object.type)
            if typeInfo.endswith("*") or typeInfo.endswith("]"):
                listItem = object.name + "[0]@" + typeInfo
            else:
                listItem = object.name + "@" + typeInfo

        returnList.append(listItem)

    return returnList


def getObjectFromName(objectList, name):
    for object in objectList:
        # function names might be overloaded
        if isinstance(object, Function) and object.vcast_name == name:
            return object
        elif object.name == name:
            return object
    return None


def getTypeDisplayName(type):
    """
    In some cases the "display_name" is a generated temporary or tag-name
    this happens for anon structures in C for example

    typedef struct {
        int a;
        } myType;

    In that case, use use the typemark vs display_name
    """

    # The anon names are always __T<address> so use regex
    returnValue = type.display_name
    if re.match("__T[0-9]", returnValue):
        returnValue = type.typemark

    return returnValue


def additionalTypeInfo(type):
    """
    For some types, we want to give a hint about the kind ...
    """

    if type.kind == "REC_ORD":
        return getTypeDisplayName(type) + "(struct)"
    elif type.kind == "UNION":
        return getTypeDisplayName(type) + "(union)"
    elif type.kind == "CLASS":
        return type.display_name + "(class)"
    elif type.kind in ["POINTER", "CLASS_PTR", "ACCE_SS"]:
        return type.element.display_name + "*"
    elif type.kind == "ADD_RESS":
        return "void*"
    elif type.kind == "AR_RAY":
        return type.element.display_name + "[]"
    else:
        return type.display_name


def getTypeClassification(type):
    """
    This function will convert the type.kind into nice neat buckets
    """

    if type.is_enumeration:
        return "enum"

    elif type.is_string:
        return "string"

    elif type.is_character:
        return "char"

    elif type.kind in ["REC_ORD", "UNION", "CLASS"]:
        return "struct"

    elif (
        type.kind in ["ACCE_SS", "ADD_RESS", "CLASS_PTR", "AR_RAY"]
        or "POINTER" in type.kind
    ):
        return "array"

    elif type.kind == "BOOL_EAN":
        return "bool"

    elif type.is_float:
        return "float"

    elif type.kind in [
        "INT_EGER",
        "FIX_ED",
        "M_OD",
        "BIT",
        "UN_SIGNED",
        "SHORT_INT",
        "LONG_INT",
        "UNSIGNED_SHORT",
        "UNSIGNED_LONG",
        "DEC_IMAL",
        "POS_ITIVE",
        "SHORT_SHORT",
        "TINY_INT",
        "BYTE_INT",
        "LONG_LONG",
        "UNSIGNED_LONG_LONG",
        "NAT_URAL",
        "BUILTIN_QUAD",
        "INT40_T",
        "UNSIGNED_INT40_T",
        "SHORT_LONG",
        "UNSIGNED_SHORT_LONG",
        "INT128",
        "UNSIGNED_INT128",
    ]:
        return "int"

    else:
        """
        This will catch these:
            SUB_TYPE, PRI_VATE, LIMIT_ED, T_ASK, UNKNOWN,
            PRO_TECTED, GENERIC_TYPE, NOT_SUPPORTED, FORWARD_DECL,
            STD_CONTAINER, STD_MAP_CONTAINER, STD_PAIR
            SBIT, SFRA, SFRB, SFRW
        """
        return ""


def processType(type, commandPieces, currentIndex, triggerCharacter):
    """
    This recursive function will walk the type and return a list of
    strings that make up the downstream

    type is the dataAPI type of the node we are currently processing

    commandPieces is a list of what the user has entered so far
    So it will look something like this:
    test -> value -> manager -> placeOrder -> order -> Entree ->

    currentIndex tells us what node we are currently processing
    this parameter will be incremented if we recurse.

    We are "done" processing, when the currentIndex = the commandPieces length -1

    """
    global globalOutputLog
    returnData = choiceDataType()

    typeClassification = getTypeClassification(type)

    if typeClassification == "enum":
        if triggerCharacter == ":":
            enumChoices = list()
            for e in type.enums:
                enumChoices.append(e.name)
            returnData.choiceList = enumChoices
            returnData.choiceKind = choiceKindType.Enum

    elif typeClassification == "string":
        if triggerCharacter == ":":
            returnData.choiceList.append("string")
            returnData.choiceKind = choiceKindType.Constant

    elif typeClassification == "char":
        if triggerCharacter == ":":
            returnData.choiceList.append("scalar@character")
            returnData.choiceKind = choiceKindType.Constant

    elif typeClassification == "struct":
        fieldObjectList = list()
        fieldNameList = list()
        choiceList = list()
        for f in type.child_fields:
            fieldObjectList.append(f)
            fieldNameList.append(f.name)
            typeInfo = additionalTypeInfo(f.type)
            if typeInfo.endswith("*") or typeInfo.endswith("]"):
                choiceList.append(f.name + "[0]@" + typeInfo)
            else:
                choiceList.append(f.name + "@" + typeInfo)
        if len(commandPieces) == currentIndex + 1:
            returnData.choiceList = choiceList
            returnData.choiceKind = choiceKindType.Field

        else:
            currentField = commandPieces[currentIndex].split("[")[0]
            if currentField in fieldNameList:
                index = fieldNameList.index(currentField)
                return processType(
                    fieldObjectList[index].type,
                    commandPieces,
                    currentIndex + 1,
                    triggerCharacter,
                )

    elif typeClassification == "array":
        # VS Code gives us the closing ] for free ...
        # so we only need to recurse when we are past this
        if len(commandPieces) > currentIndex:
            # make sure that the string has an index expression ...
            if (
                "[" in commandPieces[currentIndex - 1]
                and "]" in commandPieces[currentIndex - 1]
            ):
                # recurse based using the array element type
                # We don't need to increment the currentIndex because
                # the index and the name are all wrapped up into one piece (e.g. array[3])
                return processType(
                    type.element, commandPieces, currentIndex, triggerCharacter
                )

    elif typeClassification == "bool":
        if triggerCharacter == ":":
            returnData.choiceList.append("true")
            returnData.choiceList.append("false")
            returnData.choiceKind = choiceKindType.Enum

    elif typeClassification in ["int", "float"]:
        if triggerCharacter == ":":
            returnData.choiceList.append("scalar@number")
            returnData.choiceKind = choiceKindType.Constant

    else:  # "other" case
        globalOutputLog.append("processtype ignored type: " + type.kind)

    return returnData


tagForGlobals = "<<GLOBAL>>"


def getFunctionList(api, unitName):
    """
    common code to generate list of functions ...
    """
    returnList = list()
    unitObject = getObjectFromName(api.Unit.all(), unitName)
    # unitName might be invalid ...
    if unitObject:
        functionList = unitObject.functions
        returnList = getNameListFromObjectList(functionList)
        # seems like a vcast dataAPI bug, that <<INIT>> is in this list
        if "<<INIT>>" in returnList:
            returnList.remove("<<INIT>>")
        if len(unitObject.globals) > 0:
            returnList.append(tagForGlobals)

    return returnList


def getTestList(api, unitName, functionName):
    returnList = list()
    unitObject = getObjectFromName(api.Unit.all(), unitName)
    if unitObject:
        functionObject = getObjectFromName(unitObject.functions, functionName)
        if functionObject:
            for testObject in functionObject.testcases:
                returnList.append(testObject.name)

    if len(returnList) > 0:
        return returnList
    else:
        return ["no test cases exist"]


# choiceKindType should match the VS Code CompletionItemKind type
# Surprisingly there is no "parameter" kind, so I just use Field for parameters
class choiceKindType(str, Enum):
    Constant = "Constant"
    Enum = "Enum"
    Field = ("Field",)
    File = ("File",)
    Function = ("Function",)
    Keyword = ("Keyword",)
    Property = "Property"
    Value = "Value"
    Variable = "Variable"


class choiceDataType:
    choiceList = list()
    choiceKind = choiceKindType.Keyword


def processRequirementLines(api, pieces, triggerCharacter):
    """
    This funciton will compute the list of possible requirement keys and return
    a list of key | description pairs
    """
    returnData = choiceDataType()
    lengthOfCommand = len(pieces)

    requirements = api.environment.requirement_api.Requirement.all()
    for requirement in requirements:
        # the description can have multipl
        returnData.choiceList.append(
            f"{requirement.external_key} ||| {requirement.title} ||| {requirement.description}"
        )

    return returnData


def processSlotLines(api, pieces, triggerCharacter):
    """
    This function handles slot lines that look like this:
       TEST.SLOT: 1, manager, Manager::PlaceOrder, 1, Manager::PlaceOrder.001
    """

    global globalOutputLog
    returnData = choiceDataType()

    lengthOfCommand = len(pieces)

    if lengthOfCommand == 2 and triggerCharacter == ":":  # Slot Number
        returnData.choiceList.append("<slot-number>")
        returnData.choiceKind = choiceKindType.Constant

    elif lengthOfCommand == 3 and triggerCharacter == ",":  # Unit
        objectList = api.Unit.all()
        returnData.choiceList = getNameListFromObjectList(objectList)
        returnData.choiceKind = choiceKindType.File

    elif lengthOfCommand == 4 and triggerCharacter == ",":  # function
        returnData.choiceList = getFunctionList(api, pieces[2])
        returnData.choiceKind = choiceKindType.Function

    elif lengthOfCommand == 5 and triggerCharacter == ",":  # iterations
        returnData.choiceList.append("<iteration-count>")
        returnData.choiceKind = choiceKindType.Constant

    elif lengthOfCommand == 6 and triggerCharacter == ",":  # test-case
        unitName = pieces[2]
        functionName = pieces[3]
        returnData.choiceList = getTestList(api, unitName, functionName)
        returnData.choiceKind = choiceKindType.Property

    return returnData


def processStandardLines(api, pieces, triggerCharacter):
    """
    This function process everything except TEST.SLOT and TEST.REQUIREMENT_KEY lines
    """
    global globalOutputLog

    returnData = choiceDataType()

    lengthOfCommand = len(pieces)

    # we should never be called with TEST. for example
    if lengthOfCommand < 3:
        globalOutputLog.append("Line has less than 3 fields ...")

    elif lengthOfCommand == 3 and triggerCharacter == ":":  # Unit
        objectList = api.Unit.all()
        returnData.choiceList = getNameListFromObjectList(objectList)
        returnData.choiceKind = choiceKindType.File

    elif lengthOfCommand == 4 and triggerCharacter == ".":  # Function
        returnData.choiceList = getFunctionList(api, pieces[2])
        returnData.choiceKind = choiceKindType.Function

    elif (
        lengthOfCommand == 5 and triggerCharacter == "."
    ):  # parameters and global objects
        unitName = pieces[2]
        unitObject = getObjectFromName(api.Unit.all(), unitName)
        functionList = unitObject.functions

        functionName = pieces[3]
        # functionNAme can be <<GLOBAL>> ...
        if functionName == tagForGlobals:
            globalsList = unitObject.globals
            returnData.choiceList = getNameListFromItemList(globalsList)
            returnData.choiceKind = choiceKindType.Variable
        else:
            functionObject = getObjectFromName(functionList, functionName)
            try:
                paramList = functionObject.parameters
                returnData.choiceList = getNameListFromItemList(paramList)
                returnData.choiceKind = choiceKindType.Field
            except:
                pass

    elif lengthOfCommand > 5:  # in field | array index | value part
        unitName = pieces[2]
        unitObject = getObjectFromName(api.Unit.all(), unitName)
        functionName = pieces[3]
        paramName = pieces[4].split("[")[0]
        if functionName == tagForGlobals:
            globalsList = unitObject.globals
            itemObject = getObjectFromName(globalsList, paramName)
        else:
            functionList = unitObject.functions
            functionObject = getObjectFromName(functionList, functionName)
            paramList = functionObject.parameters
            itemObject = getObjectFromName(paramList, paramName)

        # we pass index 5 to walk the parameter type
        if itemObject:
            returnData = processType(itemObject.type, pieces, 5, triggerCharacter)

    return returnData


def splitExistingLine(line):
    """
    We need to split the input line based on delimiters: '.' ':' ','
    comma is only for slots so to support this and do the
    right thing when there are overloaded functions we do this in parts
    """

    if line.upper().startswith("TEST.SLOT"):
        # split by : and , but ignore , in ()
        pieces = re.split("(?<!:)[:\,](?!:)(?![^\(]*\))", line)
    else:
        # split by : and .
        pieces = re.split("(?<!:)[:\.](?!:)", line)

    # strip any extra white space
    return [x.strip() for x in pieces]


def getUnitAndFunction(lineSoFar):
    """
    This function will get called with the lineSoFar for
    the curent line being editted.  When we get here the line
    will look someting like:
         void vmock_
         void vmock_myUnit_
         void vmock_myUnit_myFunction (
    """
    pieces = lineSoFar.split("_")
    unitString = ""
    functionString = ""

    # the first piece will be "void vmock_" or void vmock_myUnit
    # done in multiple steps for clarity

    # TBD today, does not work with void^^^vmock_

    # if we have a unit name provided ...
    if len(pieces) > 1 and len(pieces[1]) > 0:
        unitString = pieces[1]

        # if we have a subprogram name provided ...
        if len(pieces) > 2 and len(pieces[2]) > 0:
            functionString = pieces[1].split("(")[0].strip()

    return unitString, functionString


unitsToIgnore = ["uut_prototype_stubs", "USER_GLOBALS_VCAST"]


def processVMockLine(enviroName, lineSoFar):
    """
    This function will process vmock_  line completions for coded tests
    When we get here, the line will always start with vmock, and end
    with "_" or (, like this:

          void vmock_
          void vmock_myUnit_
          void vmock_myUnit_myFunction (

    Our job is to return what comes next.  For the _ cases, we need to return
    everything up to that point, so if we see vmock_myUnit_ we need to return

            vmock_myUnit_myFunction1, vmock_myUnit_myFunction2, ...

    This is just because of how VS Code does auto-completion
    """

    returnData = choiceDataType()

    api = UnitTestApi(enviroName)

    # TBD today, do we need this?
    returnData.choiceKind = choiceKindType.Value

    unitName, functionName = getUnitAndFunction(lineSoFar)
    if unitName == "":

        unitNameList = api.Unit.all()

        # prepend each unitName with "vmock_" and and store into listToReturn
        for unitObject in unitNameList:
            if unitObject.name not in unitsToIgnore:
                returnData.choiceList.append("vmock_" + unitObject.name)

    elif functionName == "":

        functionNameList = getFunctionList(api, unitName)

        # prepend each functionName with "vmock_" and and store into listToReturn
        for functionName in functionNameList:
            returnData.choiceList.append("vmock_" + unitName + "_" + functionName)

    elif lineSoFar.endswith("("):

        # TBD today need to get the parameter profile for the stubbed function
        returnData.choiceList.append("::vunit::CallCtx<DataBase> vunit_ctx, ...")

    api.close()

    return returnData


def processTstLine(enviroName, line):
    """

    This function will process TEST.<command> line completions

    It will build the choice list for the "next" field
    based on the line the user has entered so far.

    To make this simpler, I did not handle all the edge cases,
    for now I'm using the exception handler.

    Input examples:
        1    2      3        4        5      6  <- lengthOfLine
        0    1      2        3        4      5  <- index into pieces
       TEST.VALUE:manager.
       TEST.VALUE:manager.PlaceOrder.
       TEST.VALUE:manager.PlaceOrder.Order.Beverage

    the pieces will always be one more than the
    fields entered so far, since the last piece will be ""
    """
    global globalOutputLog

    try:
        globalOutputLog.append("Processing: '" + line + "' ...")

        # open the environment ...
        api = UnitTestApi(enviroName)

        # Intelligently split the line into its fields
        pieces = splitExistingLine(line)

        # if the line ended in a delimiter than the last item in the
        # list will be a zero length string, if not it will be a partial
        # field so we pop it and add a null string
        if len(pieces[-1]) == 0:
            triggerCharacter = line[-1]
        else:
            pieces.pop()
            pieces.append("")
            # find all delimiters, regex cuz we might have :: in function names.
            delimiterList = re.findall(r"(?<!:)[:\.\,](?!:)", line)
            # the last delimiter is the one we want
            triggerCharacter = delimiterList[-1]

        # when we get here, the last element in the list of pieces will always be ""

        if line.upper().startswith("TEST.SLOT"):
            returnData = processSlotLines(api, pieces, triggerCharacter)
        elif line.upper().startswith("TEST.REQUIREMENT_KEY"):
            returnData = processRequirementLines(api, pieces, triggerCharacter)
        else:
            returnData = processStandardLines(api, pieces, triggerCharacter)

        api.close()
        return returnData

    except Exception as err:
        globalOutputLog.append("-" * 100)
        globalOutputLog.append("Exception occurred ...")
        trace = traceback.format_exc()
        for traceLine in trace.split("\n"):
            if len(traceLine) > 0:
                globalOutputLog.append(traceLine)
        globalOutputLog.append("-" * 100)
        return choiceDataType()


# Some unit tests
def main():

    print(f"unit, function: {getUnitAndFunction('vmock_')}")
    print(f"unit, function: {getUnitAndFunction('vmock_myFunction_')}")
    print(f"unit, function: {getUnitAndFunction('vmock_myFunction_myUnit ')}")
    print(f"unit, function: {getUnitAndFunction('vmock_myFunction_myUnit   (')}")


if __name__ == "__main__":
    main()
