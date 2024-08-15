from string import Template

# Tag for the init (typically which we want to ignore)
TAG_FOR_INIT = "<<INIT>>"

# Tag for global objects
TAG_FOR_GLOBALS = "<<GLOBAL>>"

# Coded Test Subprogram Name
CODED_TEST_SUBPROGRAM_NAME = "coded_tests_driver"

# Template string for the mock body
MOCK_ENABLE_DISABLE_TEMPLATE = Template(
    """
void ${mock}_enable_disable(vunit::MockSession &vmock_session, bool enable = true) {
    ${mock_enable_body}
}
""".strip(
        "\n"
    )
)
