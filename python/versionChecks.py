import functools

from vector.enums import ENVIRONMENT_VERSION_TYPE_T


@functools.cache
def vpythonHasCodedTestSupport():
    """
    Determine if the current version of vpython supports coded tests (result is
    cached to avoid duplicate computation).

    This function performs one check:

        * Does it have the `Parser` package?
    """

    retVal = False
    try:
        from vector.lib.coded_tests import Parser

        retVal = True
    except ImportError:
        pass
    return retVal


@functools.cache
def vpythonHasCodedMockSupport():
    """
    Determine if the current version of vpython supports coded mocks (result is
    cached to avoid duplicate computation).

    This function performs three checks:

        * Does it have the `mock_helper` package?

        * Is `mock_helper` at the right version?

        * Does it have environemnt revision REVISION_2024_CODED_MOCK_DATA?

    NOTE: we don't need to check if an environment supports coded mocks, only a
    version of _VectorCAST_.

    If an environment doesn't have coded tests enabled (or it was originally
    build with a version of VectorCAST that did not support coded tests/coded
    mocks) and we open it up with a version of VectorCAST with `mock_helper`,
    then `.mock.` will be set to `None`.
    """

    retVal = False
    try:
        # Does the package exist?
        from vector.apps.DataAPI import mock_helper

        # The version of mock helper this version of the extension supports
        #
        # NOTE: for future versions, we might need to work out how to support
        # multiple versions of `mock_helper` (e.g., via having our own
        # translation layers, etc.) to allow us to support multiple versions of
        # VectorCAST with differing versions of `mock_helper`.
        supportedMockApiVersion = 1

        # We only enable coded mocks if the version of `mock_helper` is <= than our
        # supported version
        mockHelperCompatible = mock_helper.MOCK_API_MAJOR <= supportedMockApiVersion

        # Check if this version of vpython knows about
        # `REVISION_2024_CODED_MOCK_DATA`
        hasRevision2024CodedMockData = hasattr(
            ENVIRONMENT_VERSION_TYPE_T, "REVISION_2024_CODED_MOCK_DATA"
        )

        retVal = hasRevision2024CodedMockData and mockHelperCompatible

    except ImportError:
        pass

    return retVal


def enviroSupportsMocking(api):
    """
    Determine if the current _environment_ supports coded mocks.

    The current environment supports mocking if vpython supports mocking, and
    the environment is built at at least 'REVISION_2024_CODED_MOCK_DATA'

    NOTE: vpythonHasCodedMockSupport() is False if ENVIRONMENT_VERSION_TYPE_T
    does not have REVISION_2024_CODED_MOCK_DATA, so it is safe to try accessing
    this attribue (i.e., it will not raise an attribute error)
    """

    return (
        vpythonHasCodedMockSupport()
        and api.environment.version_enum
        >= ENVIRONMENT_VERSION_TYPE_T.REVISION_2024_CODED_MOCK_DATA
    )
