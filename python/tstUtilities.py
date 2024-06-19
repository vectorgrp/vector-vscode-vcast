"""
//////////////////////////////////////////////////////////////////////////////
this started life as a duplicate of:  dataAPIInterface/tstUtilities.py
//////////////////////////////////////////////////////////////////////////////
"""

from enum import Enum
import re
import sys
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
        globalOutputLog.append("process type ignored type: " + type.kind)

    return returnData


tagForGlobals = "<<GLOBAL>>"
tagForInit = "<<INIT>>"


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
            returnList.remove(tagForInit)
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
    Snippet = "Snippet"
    Value = "Value"
    Variable = "Variable"


class choiceDataType:
    choiceList = list()
    extraText = ""
    choiceKind = choiceKindType.Keyword


def processRequirementLines(api, pieces, triggerCharacter):
    """
    This function will compute the list of possible requirement keys and return
    a list of key | description pairs
    """
    returnData = choiceDataType()
    lengthOfCommand = len(pieces)

    requirements = api.environment.requirement_api.Requirement.all()
    for requirement in requirements:
        # the description can have multiple lines, so we just take the first line
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


# see comment below for what the patterns this matches
unitAndFunctionRegex = "^\s*\/\/\s*vmock\s*(\S+)\s*(\S+)?.*"
# units to not be shown in the unit list
unitsToIgnore = ["USER_GLOBALS_VCAST"]
# function to not be shown in the functions list
# TBD today - these <<INIT>> functions should not be in the list
# Waiting for PCT fix of FB: 101353 - vc24sp3?
functionsToIgnore = ["coded_tests_driver", "<<INIT>>"]


def getUnitAneFunctionStrings(lineSoFar):
    # using a regex is the simplest way to extract the unit and function names
    match = re.match(unitAndFunctionRegex, lineSoFar)
    if match:
        unitString = match.group(1)
        functionString = match.group(2)
    else:
        unitString = None
        functionString = None

    return unitString, functionString


def getUnitAndFunctionObjects(api, unitString, functionString):
    """
    This function will get called with the lineSoFar for
    the current line being edited.  When we get here the line
    will look something like (regex implements this)
         // vmock                    - return list of units
         // vmock myUn               - return list of units that start with myUn
         // vmock myUnit             - return list of functions
         // vmock myUnit myFunc      - return list of functions that starts with myFunc
         // vmock myUnit myFunction  - return full declaration

    Other notes:
        - overloaded names should be parameterized in the vmock style

    The return values will be a list of unitObjects and function objects that
    match the input strings.  If there is an exact match we will return a
    single object, for a partial match we'll return the filtered list,
    and if there is no match we'll return the full list
    """

    unitList = api.Unit.all()
    returnUnitList = []
    returnFunctionList = []

    #  first build the unit list
    for unitObject in unitList:

        if unitObject.name not in unitsToIgnore:
            # if no unit string was entered, return all unit objects
            if unitString == None:
                returnUnitList.append(unitObject)

            # if there is an exact match, return a list with a single unit
            elif unitObject.name == unitString:
                returnUnitList = [unitObject]
                break

            # else return a filtered list that matches the entry so far
            elif unitObject.name.startswith(unitString):
                returnUnitList.append(unitObject)

    # if the unit name is an exact match, process the function name
    if len(returnUnitList) == 1:
        # check if the function name matches any of the functions in the unit
        for functionObject in unitObject.functions:

            if functionObject.vcast_name not in functionsToIgnore:

                # vcast name will have the parameterization if the function is overloaded
                parameterizedName = functionObject.vcast_name

                # if no function name was entered, return all function objects
                if functionString == None:
                    returnFunctionList.append(functionObject)

                # if there is an exact match, return a list with a single object
                elif parameterizedName == functionString:
                    returnFunctionList = [functionObject]
                    break

                elif parameterizedName.startswith(functionString):
                    returnFunctionList.append(functionObject)

    # for an exact match of what the user entered, we will return
    # lists with a single object for each
    return returnUnitList, returnFunctionList


def createFunctionSignature(functionObject, parameterTypeList):
    """
    Create the signature for a vmock object, something like this:
        ::vunit::CallCtx<myClass> vunit_ctx, const char* param1
    """

    # if this function is a class member, we include the class name
    instantiatingClass = ""
    if "::" in functionObject.name:
        instantiatingClass = functionObject.name.rsplit("::", 1)[0]

    # the static part of the signature looks like this,
    # we will append the parameters next
    signatureString = f"::vunit::CallCtx<{instantiatingClass}> vunit_ctx,"

    paramIndex = 0
    for parameterObject in functionObject.parameters:

        if parameterObject.name != "return":

            # TBD today - need new type string from vcast
            # Waiting for PCT fix of FB: 101295 - vc24sp3?
            typeString = parameterTypeList[paramIndex]
            paramIndex += 1

            # for arrays, the typeString will end with "]"
            # and we need to change int[] param to int param[]
            if typeString.endswith("]"):
                startOfArrayQualifier = typeString.find("[", 1)
                typeStringOnly = typeString[:startOfArrayQualifier]
                arraySize = typeString[startOfArrayQualifier:]
                parameterString = (
                    f" {typeStringOnly} {parameterObject.name}{arraySize},"
                )
            else:
                parameterString = f" {typeString} {parameterObject.name},"
            signatureString += parameterString

    # In all cases the returnString will end with a "," so strip this
    signatureString = signatureString[:-1]

    return signatureString


def getFunctionName(unitName, functionName):
    """
    We use the vmock with the unit and function names as the default
    stub name, the user can edit this to make it unique
    """
    returnName = "vmock_"
    returnName += unitName + "_"
    # overloaded functions will have the parameterization
    functionNameToUse = functionName.split("(")[0]
    returnName += functionNameToUse.replace("::", "_")

    return returnName


def findCommas(parameterString):
    """
    I know this could probably be done with a complex regex
    but it would be almost impossible to understand :)
    """
    commasOfInterest = list()
    openTemplate = 0
    for index, char in enumerate(parameterString):
        if openTemplate > 0:
            if char == ">":
                openTemplate + -1
        elif char == "<":
            openTemplate += 1
        elif char == ",":
            commasOfInterest.append(index)

    # we return a list of the commas we found and add a
    # "virtual comma" for the end of the string
    commasOfInterest.append(len(parameterString))
    return commasOfInterest


def getParameterTypesFromParameterization(functionObject):
    """
    This function will take a parameterized name and return a list of types
    The input string will be something like: '(char*)int'
    where char* is the parameter, and int is the return
    """

    # first build the list of parameter types
    paramTypes = list()
    parameterizedName = functionObject.parameterization
    parameterString = parameterizedName.split("(")[1].split(")")[0]

    paramTypes = list()
    commasOfInterest = findCommas(parameterString)
    startCharacter = 0
    for commaIndex in commasOfInterest:
        paramTypes.append(parameterString[startCharacter:commaIndex])
        startCharacter = commaIndex + 1

    return paramTypes


def getReturnType(functionObject):

    # get the return type from the parameterized name
    parameterizedName = functionObject.parameterization
    returnType = parameterizedName.split(")")[1]

    if returnType == None or len(returnType) == 0:
        returnType = "void"

    return returnType


def getUsageString(functionObject, parameterTypeList, vmockFunctionName):
    """
    There are three variations of code needed to connect a mock definition with the function being mocked

    The normal case looks like this
    vmock_session.mock (&userFunctionName).assign (&vmockFunctionName);

    For an overloaded function, we must add parameterization to the user function name
    vmock_session.mock <int(myClass::*)(int)> (&userClass::userMethod).assign (&vmockFunctionName);

    For a template mock, we must add the template parameters to the user function name
    vmock_session.mock (&userFunction<int, int>).assign (&vmockFunctionName);

    """

    functionName = functionObject.vcast_name

    # start with the static part of the expression
    returnString = "Usage: vmock_session.mock "

    # add the user function name, there are two special cases as described above

    # if this is a function template
    if functionObject.prototype_instantiation:

        # TBD today - need new template support from vcast
        # Waiting for PCT fix of FB: 101345 - vc224sp3?

        # In function object I found: name_with_template_arguments but there is no <> part
        functionNameWithoutParams = functionName.split("(")[0]
        returnString += f"(&{functionNameWithoutParams}<insert-template-param-types>)"

    # else if it is an overloaded function
    elif functionObject.is_overloaded:
        # currentFunctionName will have the full name like
        # className::MethodName(int, int)int

        # so first split off the return type, allowing for void
        returnType = getReturnType(functionObject)

        # next create the function pointer part ether * or className::*
        if "::" in functionName:
            fptrString = functionName.split("::")[0] + "::*"
        else:
            fptrString = "*"

        paramTypeString = ",".join(parameterTypeList)

        returnString += f"<{returnType}({fptrString})({paramTypeString})> (&{functionName.split('(')[0]})"

    else:
        returnString += f"(&{functionName})"

    # add the final piece that contains the mock function name
    returnString += f".assign (&{vmockFunctionName});"

    return returnString


def generateVMockDefitionForUnitAndFunction(unitObject, functionObject):

    vmockFunctionName = getFunctionName(unitObject.name, functionObject.vcast_name)

    # TBD today - need new type string from vcast
    # Waiting for PCT fix of FB: 101295 - vc24sp3?

    # To get the original type definition, we need to deconstruct
    # the parameterized name, vs using the parameter typemark
    parameterTypeList = getParameterTypesFromParameterization(functionObject)

    signatureString = createFunctionSignature(functionObject, parameterTypeList)
    returnType = getReturnType(functionObject)

    usageString = getUsageString(
        functionObject,
        parameterTypeList,
        vmockFunctionName,
    )

    whatToReturn = (
        f"\n{returnType} {vmockFunctionName}({signatureString})"
        + " {\n  // "
        + usageString
        + "\n\n}"
    )

    return whatToReturn


def processVMockDefinition(enviroName, lineSoFar):
    """
    This function will process vmock_  line completions for coded tests
    When we get here, the line will always start with vmock, and end
    with "_" or (, like this:

          // vmock
          // vmock myUnit
          // vmock myUnit myFunction

    Our job is to return what comes next.

    """

    returnData = choiceDataType()

    api = UnitTestApi(enviroName)

    # TBD today - need unit tests for this

    # if what the user entered so far is an each match for the unit and function
    # we will get a single object in each list, else we will get a filtered list
    # based on what was entered

    # get the unit and function names entered by the user
    unitString, functionString = getUnitAneFunctionStrings(lineSoFar)

    # use these to get the matching unit and function objects or object lists
    unitObjectList, functionObjectList = getUnitAndFunctionObjects(
        api, unitString, functionString
    )

    # if multiple unit objects match what was entered
    # of if no unitName was just entered by the user
    # build the choice list
    if len(unitObjectList) > 1 or unitString == None:
        returnData.choiceKind = choiceKindType.File
        for unitObject in unitObjectList:
            returnData.choiceList.append(unitObject.name)

    # if multiple function objects match what was entered
    # or if no functionName was just entered by the user
    # build choice list
    elif len(functionObjectList) > 1 or functionString == None:
        for functionObject in functionObjectList:
            # vcast_name will be parameterized if the function is overloaded
            returnData.choiceList.append(functionObject.vcast_name)

    # else the unit and function names are both valid so build the definition
    elif len(unitObjectList) == 1 and len(functionObjectList) == 1:

        unitObject = unitObjectList[0]
        functionObject = functionObjectList[0]

        whatToReturn = generateVMockDefitionForUnitAndFunction(
            unitObject, functionObject
        )

        returnData.choiceKind = choiceKindType.Snippet
        returnData.choiceList.append(whatToReturn)

    api.close()

    return returnData


def processVMockSession(enviroName, lineSoFar):

    returnData = choiceDataType()
    returnData.choiceKind = choiceKindType.Variable
    returnData.choiceList.append(" ::vunit::MockSession();")

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


# Unit Tests
def main():
    pass


if __name__ == "__main__":
    main()
