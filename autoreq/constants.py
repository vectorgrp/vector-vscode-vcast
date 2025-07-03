from pathlib import Path

APP_NAME = 'autoreq'
TEST_FRAMEWORK_REFERENCE_PATH = (
    Path(__file__).parent / 'resources/test_framework_reference.md'
).resolve()
TEST_COVERAGE_SCRIPT_PATH = (
    Path(__file__).parent / 'resources/v_coverage.py'
).resolve()

SOURCE_FILE_EXTENSIONS = (
    'c',
    'cpp',
    'cxx',
    'cc',
    'c++',
    'tpp',
    'h',
    'hpp',
    'hxx',
    'hh',
    'hp',
    'ipp',
)
