"""
This file contains all the special stuff we need to do to compute the LSE stuff for Coded Mocks,
along with any of the work around's for existing bugs or missing features
"""

from string import Template
from vector.apps.DataAPI import mock_helper

# Tag for the init, which we want to ignore
TAG_FOR_INIT = "<<INIT>>"


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

    expr = f"enable ? &{mockFunctionName} : nullptr"
    mock_enable_body = mock_helper.generateMockEnableBody(
        functionObject, expr=expr
    ).strip()

    mock_enable_disable = MOCK_ENABLE_DISABLE_TEMPLATE.safe_substitute(
        mock=mockFunctionName,
        mock_enable_body=mock_enable_body,
    )
    mock_enable_call = f"{mockFunctionName}_enable_disable(vmock_session);"

    return mock_enable_disable, mock_enable_call
