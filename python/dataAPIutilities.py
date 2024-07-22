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
            declarationToUse = parameterObject.bare_orig_declaration
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
    # PCT-FIX-NEEDED - issue #13 - generate_mock_declaration is incorrect when
    # the function is a free function in a namespace
    #
    # This whole function should be replaced with:
    #
    #       functionObject.generate_mock_declaration(mockFunctionName)
    #
    # Once #13 is fixed.
    #
    # You should then remove: getParameterList and getFunctionSignature

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
    # PCT-FIX-NEEDED - feature request for 'getInstantiatingClass' (includes
    # detailed example)
    #
    # Currently we do lots of processing to ensure we use the right string for
    # a function's 'callCtx' (e.g., if the function is a free function, or if
    # it is a static method), given VectorCAST already calculates this, it
    # would be good if this could be stored in DataAPI as well.

    # Get the mock lookup type -- this now *does not* have the return type
    mockLookupType = functionObject.mock_lookup_type

    # It should start with `(`
    assert mockLookupType[0] == "("

    # We now want to find the place where we have an even number of round
    # brackets, with the last closing bracket signifying the end the "context"
    #
    # endIdx is then the position in the string where the context type ends
    endIdx = -1
    openParen = 0
    for idx, char in enumerate(mockLookupType):
        if char == "(":
            openParen += 1
        elif openParen == 1 and char == ")":
            endIdx = idx
            break
        elif char == ")":
            openParen -= 1

    # endIdx should now be a `*`
    assert mockLookupType[endIdx - 1] == "*"

    # Grab the string from after the opening `(` to before the `*`
    instantiatingClass = mockLookupType[1 : endIdx - 1]

    # Remove trailing whitespace
    instantiatingClass = instantiatingClass.strip()

    # If we happened to be a class, we're going to have `::`, so we want to
    # remove that
    if instantiatingClass.endswith("::"):
        instantiatingClass = instantiatingClass.rstrip(":")

    # Now we have our instantiating class
    return instantiatingClass


def getFunctionNameForAddress(api, functionObject):
    # PCT-FIX-NEEDED - feature request for 'getFunctionNameForAddress'
    # (includes detailed example)
    #
    # Currently we do lots of processing to ensure we use the right string for
    # a function's address, given VectorCAST already calculates this, it would
    # be good if this could be stored in DataAPI as well.

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
        #
        # We also need to handle: scope::scope::template<args
        # (*)>::scope::operator, so we can't just split on `(`

        parts = functionName.split("operator")

        # FIXME: remove this once we've done a run and we know we only get one!
        assert len(parts) == 2

        before, after = parts

        functionName = before + "operator" + after.split("(")[0]

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
void ${mock}_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    using vcast_mock_rtype = ${original_return} ;
    vcast_mock_rtype ${lookup_decl} ${const} = &${function};
    vmock_session.mock <vcast_mock_rtype ${lookup_type}> ((vcast_mock_rtype ${lookup_type})vcast_fn_ptr).assign (enable ? &${mock} : nullptr);
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

    # We need to reintroduce the 'vcast_fn_ptr' string into the look-up, when
    # first declaring the function pointer (but when use the type later on, we
    # don't want the variable name in there)
    if "::*" in lookup_type:
        # If we're a method, we only see this in one place
        lookup_decl = lookup_type.replace("::*)(", "::*vcast_fn_ptr)(", 1)
    else:
        # Otherwise, let's guess, but this could convert "too much" (e.g., in
        # functions that take function pointers)
        lookup_decl = lookup_type.replace("*)(", "*vcast_fn_ptr)(", 1)
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
    mock_enable_call = f"{mockFunctionName}_enable_disable(vmock_session);"

    return mock_enable_disable, mock_enable_call
