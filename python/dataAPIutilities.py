"""
This file contains all the special stuff we need to do to compute the LSE stuff for Coded Mocks,
along with any of the work around's for existing bugs or missing features
"""

from string import Template
from vector.apps.DataAPI import mock_helper

# Tag for the init, which we want to ignore
TAG_FOR_INIT = "<<INIT>>"


def functionCanBeMocked(functionObject):
    """
    # PCT-FIX-NEEDED - issue #7 - is_mockable not dependable
    # Should be replaced by a single check of is_mockable

    # PCT-FIX-NEEDED - issue #8 - constructors listed as <<init>> function
    # these <<INIT>> functions should not be in the list
    # Waiting for PCT fix of FB: 101353.
    """

    # FIXME: 'coded_tests_driver' claims it has mock info
    if functionObject.vcast_name == "coded_tests_driver":
        return False

    # This allows us to support older versions of VectorCAST
    if hasattr(functionObject, "mock"):
        return functionObject.mock is not None

    # FIXME: this now says unless we have a mock attribute, that we _do not_
    # support mocking
    return False


MOCK_ENABLE_DISABLE_TEMPLATE = Template(
    """
void ${mock}_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    ${mock_enable_body}
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

    # FIXME: we should be passing in an `expr` and not `mockFunctionName`
    mock_enable_body = mock_helper.generateMockEnableBody(
        functionObject, mockFunctionName=mockFunctionName
    ).lstrip()

    mock_enable_disable = MOCK_ENABLE_DISABLE_TEMPLATE.safe_substitute(
        mock=mockFunctionName,
        mock_enable_body=mock_enable_body,
    )
    mock_enable_call = f"{mockFunctionName}_enable_disable(vmock_session);"

    return mock_enable_disable, mock_enable_call
