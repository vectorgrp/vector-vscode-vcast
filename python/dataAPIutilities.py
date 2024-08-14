"""
This file contains all the special stuff we need to do to compute the LSE stuff for Coded Mocks,
along with any of the work around's for existing bugs or missing features
"""

from string import Template

# Tag for the init, which we want to ignore
TAG_FOR_INIT = "<<INIT>>"

# Coded Test Subprogram Name
CODED_TEST_SUBPROGRAM_NAME = "coded_tests_driver"

# list of functions not to be shown in the functions list
FUNCTIONS_TO_IGNORE = {CODED_TEST_SUBPROGRAM_NAME, TAG_FOR_INIT}


def functionCanBeMocked(functionObject):
    """
    # PCT-FIX-NEEDED - issue #7 - is_mockable not dependable
    # Should be replaced by a single check of is_mockable

    # PCT-FIX-NEEDED - issue #8 - constructors listed as <<init>> function
    # these <<INIT>> functions should not be in the list
    # Waiting for PCT fix of FB: 101353.
    """

    if functionObject.vcast_name in FUNCTIONS_TO_IGNORE:
        return False

    # Constructors are not supported by vmock
    if functionObject.is_constructor:
        return False

    # Destructors are not supported by vmock
    if "~" in functionObject.vcast_name:
        return False

    # This allows us to support older versions of VectorCAST
    if hasattr(functionObject, "is_mockable"):
        return functionObject.is_mockable

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


def generateMockEnableForUnitAndFunction(functionObject, mockFunctionName):
    """
    Note that we pass in mockFunctionName because we want getFunctionName()
    to remain in tstUtilities.py
    """

    original_return = functionObject.named_original_return_type("")
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

    # Is it const?
    const = "const" if functionObject.is_const else ""

    # What's the function name to use?
    function_name = functionObject.cpp_ref_name

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
