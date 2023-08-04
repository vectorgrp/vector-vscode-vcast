# Change Log

All notable changes to the "vectorcastTestExplorer" extension will be documented in this file.

## Initial Release

- 1.0.0 - Initial Release
- 1.0.1 - Fixed repository link in README.md

## [1.0.2] - 2023-08-01

### Added support for VECTORCAST_DIR
The VectorCAST installation location can now be provided to the extension using one of the following 3 methods,
and will be checked for by the extension in the following order
- The path set in the extension option **Vectorcast Installation Location**
- The path set via the VECTORCAST_DIR environment variable
- The system PATH

## [1.0.3] - 2023-08-07

### Added support for "compound only" tests
- Added support for TEST.COMPOUND_ONLY in the script editor
- Included compound only tests in the test tree to allow editing
- Appended "[compound only]" to test names in the test explorer tree
- Added logic to skip execution of compound only tests

### Fixed a race condition on Load Test Script command
In some cases, the automatic save of the test script was not complete
by the time clicast was called to load the script.

### Added support for test script option: STRUCT_BASE_CTOR_ADDS_POINTER
This option is new for VectorCAST 23 sp2

### Fixed spelling errors / typos in source code comments