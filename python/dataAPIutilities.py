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
    In some instances, we need to remove all template arguments before doing processing.

    For example, if we have a template that returns a function pointer, then we
    see `<(*)>` in the template arguments, this means we cannot correctly
    determine if our mock should return a function pointer or not.

    By dropping all function templates from a given string, we can see if it is
    only the "return" of a function is a function pointer.
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


def getMockDeclaration(functionObject, mockFunctionName, signatureString):
    """
    This handles the special cases for the return of the mock which
    cannot simply "just" return the return type, as per DataAPI.

    This code handles two edge-cases (and the "happy path"):

        1) If the function returns a function pointer, e.g.,:

            `void (*get_fptr(void))(void)`

           then the mock looks like this:

            `void (*vmock_unit_get_fptr(::vunit::CallCtx<> vunit_ctx))(void)`

        2) If the function returns a reference to a fixed-sized array, e.g.,:

            `char const (&get())[100]`

           then the mock looks like this:

            `const char (&vmock_unit_get(::vunit::CallCtx<> vunit_ctx))[100]`

        3) Otherwise, the mock is "very normal" and looks like this:

            `void vmock_unit_foo(::vunit::CallCtx<> vunit_ctx)`
    """

    returnType = getReturnType(functionObject)

    # Need to handle when the function returns a function pointer
    if "(*)" in dropTemplates(returnType):
        stubDeclaration = returnType.replace(
            "(*)", f"(*{mockFunctionName}({signatureString}))"
        )
    elif "(&)" in dropTemplates(returnType):
        stubDeclaration = returnType.replace(
            "(&)", f"(&{mockFunctionName}({signatureString}))"
        )
    else:
        stubDeclaration = f"\n{returnType} {mockFunctionName}({signatureString})"

    return stubDeclaration


def functionCanBeMocked(functionObject):
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
    # This allows us to support older versions of VectorCAST
    elif hasattr(functionObject, "is_mockable"):
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
    elif "<" in functionName and ">" in functionName:
        # Don't split on "(" in parens
        in_count = 0
        for idx, char in enumerate(functionName):
            if char == "<":
                in_count += 1
            elif char == ">":
                in_count -= 1
            elif char == "(" and in_count == 0:
                functionName = functionName[:idx]
                break
    else:
        functionName = functionName.split("(")[0]

    return functionName


mock_template = Template(
    """
void ${mock}_connect(vunit::MockSession &vmock_session, auto mock_address) {
    using vcast_mock_rtype = ${original_return} ;
    ${lookup_decl} ${const} = &${function};
    vmock_session.mock <${lookup_type}> ((${lookup_type})original_function).assign (mock_address);
}
""".strip(
        "\n"
    )
)


def generateMockEnableForUnitAndFunction(api, functionObject, mockFunctionName):
    """
    Note that we pass in mockFunctionName because we want getFunctionName()
    to remain in tstUtilitie.py
    """

    original_return = getReturnType(functionObject)
    lookup_type = functionObject.mock_lookup_type

    # We need to reintroduce the 'lhs' string into the look-up, when
    # first declaring the function pointer (but when use the type later on, we
    # don't want the variable name in there)
    if "::*" in lookup_type:
        # If we're a method, we only see this in one place
        lookup_decl = lookup_type.replace("::*)(", "::*original_function)(", 1)
    else:
        # Otherwise, let's guess, but this could convert "too much" (e.g., in
        # functions that take function pointers)
        lookup_decl = lookup_type.replace("*)(", "*original_function)(", 1)
    const = "const" if functionObject.is_const else ""
    function_name = getFunctionNameForAddress(api, functionObject)
    mock_enable_disable = mock_template.safe_substitute(
        original_return=original_return,
        lookup_decl=lookup_decl,
        const=const,
        lookup_type=lookup_type,
        function=function_name,
        mock=mockFunctionName,
    )
    mock_enable_call = (
        f"{mockFunctionName}_connect(vmock_session, &{mockFunctionName});"
    )
    mock_disable_call = f"{mockFunctionName}_connect(vmock_session, nullptr);"

    return mock_enable_disable, mock_enable_call, mock_disable_call
