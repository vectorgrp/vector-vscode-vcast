"""
This file contains all the special stuff we need to do to compute the LSE stuff for Coded Mocks,
along with all of the work arounds for existing bugs or missing features
"""

import re

from string import Template


def getParameterList(functionObject):
    # "orig_declaration" contains both the type and the
    # parameter name as originally defined.

    # PCT-FIX-NEEDED - issue #1 - duplicate parameter names
    # A special case is unnamed parameters, where "vcast_param"
    # is used, so in this case replace with vcast_param1,2,3

    paramIndex = 0
    parameterString = ""
    for parameterObject in functionObject.parameters:
        if parameterObject.name != "return":
            paramIndex += 1
            # get parameterObject.orig_declaration
            declarationToUse = getOriginalDeclaration(parameterObject)
            if "vcast_param" in declarationToUse:
                uniqueParameterName = f"vcast_param{paramIndex}"
                declarationToUse = declarationToUse.replace(
                    "vcast_param", uniqueParameterName
                )
            parameterString += f" {declarationToUse},"

    if len(parameterString) == 0:
        return ""
    else:
        return f",{parameterString[:-1]}"


# function to not be shown in the functions list
tagForInit = "<<INIT>>"
functionsToIgnore = ["coded_tests_driver", tagForInit]


def isConstFunction(functionObject):
    """
    # PCT-FIX-NEEDED - issue #2 - is_const not dependable
    """

    parameterization = functionObject.parameterization
    returnValue = False
    if parameterization.endswith(" const") or parameterization.endswith(">const"):
        returnValue = True

    return returnValue


def getReturnType(functionObject):
    """
    # PCT-FIX-NEEDED - issue #5 - return type has trailing space
    # PCT-FIX-NEEDED - issue #9 - original_return_type sometimes has \n
    """
    return functionObject.original_return_type.rstrip().replace("\n", "")


def getOriginalDeclaration(parameterObject):
    """
    # PCT-FIX-NEEDED - issue #9 - orig_declaration sometimes has \n
    """
    return parameterObject.orig_declaration.replace("\n", "")


def dropTemplates(originalName):
    """
    # FIXME: Andrew please add a comment for what this is doiing, and why,
    as well as what we need from PCT to make this not necessary
    """
    droppedName = ""
    in_count = 0
    for idx, char in enumerate(originalName):
        if char == "<":
            in_count += 1
        elif char == ">":
            in_count -= 1
        elif in_count == 0:
            droppedName += char

    return droppedName


def getMockDeclaration(functionObject, vmockFunctionName, signatureString):
    """
    This handles the special cases for the return of the mock which
    cannot always match the return type of the original function

    # FIXME: this is likely very fragile
    Andrew please add more details here for what's going on
    and what we want from PCT to make this fool proof
    """

    returnType = getReturnType(functionObject)

    # Need to handle when the function returns a function pointer
    if "(*)" in dropTemplates(returnType):
        stubDeclaration = returnType.replace(
            "(*)", f"(*{vmockFunctionName}({signatureString}))"
        )
    elif "(&)" in returnType:
        stubDeclaration = returnType.replace(
            "(&)", f"(&{vmockFunctionName}({signatureString}))"
        )
    else:
        stubDeclaration = f"\n{returnType} {vmockFunctionName}({signatureString})"

    return stubDeclaration


def functionCanBeVMocked(functionObject):
    """
    # PCT-FIX-NEEDED - issue #7 - is_mockable not dependable
    # Should be replaced by a single check of is_mockable

    # PCT-FIX-NEEDED - issue #8 - constructors listed as <<init>> function
    # these <<INIT>> functions should not be in the list
    # Waiting for PCT fix of FB: 101353.
    """
    if functionObject.vcast_name in functionsToIgnore:
        return False
    # Constructors are not supported by vmock
    elif functionObject.is_constructor:
        return False
    # Destructors are not supported by vmock
    elif "~" in functionObject.vcast_name:
        return False
    elif hasattr(functionObject, "is_mockable"):
        # FIXME: this is a hack to avoid generating applys that don't have lookups
        # Andrew: Which example that causes this issue?
        if not functionObject.mock_lookup_type:
            return False
        else:
            return functionObject.is_mockable
    else:
        return True


def getInstantiatingClass(api, functionObject):
    # PCT-FIX-NEEDED - would like them to provide this string in functionObject
    # Should be an empty string or None if static class method.
    # Andrew please add exactly what we want to the Confluence page
    # and then update this comment with the issue number

    instantiatingClass = ""
    if "::" in functionObject.name:
        instantiatingClass = functionObject.name.rsplit("::", 1)[0]

        # Operators can take a type, and that type can have `::` in it, so we
        # need to break before the `::operator`
        operatorFollowedBySpace = "::operator "
        if operatorFollowedBySpace in instantiatingClass:
            idxOfOperatorFollowedBySpace = instantiatingClass.find("::operator ")
            instantiatingClass = instantiatingClass[:idxOfOperatorFollowedBySpace]
        elif "<" in instantiatingClass:
            # FIXME: we don't store the correct string for `get_by_typemark`.
            # However, having `<` in the name, is likely enough to know we are
            # a class and not a namespace!
            pass

        elif api.Type.get_by_typemark(instantiatingClass) is None:
            # We need to check if we get a class name after splitting; we only use
            # if it is a class.
            instantiatingClass = ""

        # FIXME: Hack to check if we're a static method or not
        if "::*" not in functionObject.mock_lookup_type:
            instantiatingClass = ""

    return instantiatingClass


# ----------------------------------------------------------------------------------------
# PCT-FIX-NEEDED - would be nice if Ian would generate the apply functions for us
# so that we don't have to do any of the processing below these lines
# ----------------------------------------------------------------------------------------


def getFunctionNameForAddress(api, functionObject):
    functionName = functionObject.vcast_name

    if functionObject.prototype_instantiation:
        functionName = functionObject.full_prototype_instantiation

    # If we're `operator()`, do nothing
    if "operator()" in functionName:
        functionName = re.split("operator\(\)", functionName)[0] + "operator()"
    elif "operator" in functionName:
        # Need to handle operator< and overloads that contain templates, but
        # where the function itself isn't templated
        #
        # This stops the logic below getting hit if we have operator< or
        # operator>
        functionName = functionName.split("(")[0]
    elif "<" in functionName and ">" in functionName:
        # FIXME: Do we need something different here?
        #
        # Need to careful when splitting the name when we have templates
        #
        # Note: we can have things like `operator<=`, so we need to check if we
        # have _both_ opening and closing <>
        in_count = 0
        for idx, char in enumerate(functionName):
            if char == "<":
                in_count += 1
            elif char == ">":
                in_count -= 1
            elif char == "(" and in_count == 0:
                functionName = functionName[:idx]
    else:
        functionName = functionName.split("(")[0]

    return functionName


mock_template = Template(
    """
void ${mock}_apply(vunit::MockSession &vmock_session) {
    using vcast_mock_rtype = ${original_return} ;
    ${lookup_decl} ${const} = &${function} ;
    vmock_session.mock <${lookup_type}> ((${lookup_type})vcast_fn_ptr).assign (&${mock});
}
""".strip(
        "\n"
    )
)


def generateVMockApplyForUnitAndFunction(api, functionObject, vmockFunctionName):
    """
    Note that we pass in vmockFunctionName because we want getFunctionName()
    to remain in tstUtilitie.py
    """

    original_return = getReturnType(functionObject)
    lookup_type = functionObject.mock_lookup_type

    # We need to reintroduce the 'vcast_fn_ptr' string, which Richard ommitted
    # (likely because Andrew asked him to omit it ... doh!)
    if "::*" in lookup_type:
        # If we're a method, we only see this in one place
        lookup_decl = lookup_type.replace("::*)(", "::*vcast_fn_ptr)(", 1)
    else:
        # Otherwise, let's guess, but this could convert "too much" (e.g., in
        # functions that take function pointers)
        lookup_decl = lookup_type.replace("*)(", "*vcast_fn_ptr)(", 1)
    const = "const" if isConstFunction(functionObject) else ""
    function_name = getFunctionNameForAddress(api, functionObject)
    mock_apply = mock_template.safe_substitute(
        original_return=original_return,
        lookup_decl=lookup_decl,
        const=const,
        lookup_type=lookup_type,
        function=function_name,
        mock=vmockFunctionName,
    )
    mock_use = f"{vmockFunctionName}_apply(vmock_session);"

    return mock_apply, mock_use
