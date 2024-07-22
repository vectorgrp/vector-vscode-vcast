"""
This file contains all the special stuff we need to do to compute the LSE stuff for Coded Mocks,
along with all of the work arounds for existing bugs or missing features
"""

import re

from string import Template


# function to not be shown in the functions list
tagForInit = "<<INIT>>"
functionsToIgnore = ["coded_tests_driver", tagForInit]


def getReturnType(functionObject):
    """
    # PCT-FIX-NEEDED - issue #14 - Function call needs empty string
    """
    return functionObject.named_original_return_type("")


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


def getMockDeclaration(functionObject, mockFunctionName):
    return functionObject.generate_mock_declaration(mockFunctionName)


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

    # FIXME: this is gets renamed to cpp_ref_name in a subsequent commit (and
    # then *does not* have the leading '&')
    function_name = functionObject.mock_address.lstrip("&")

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
