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


## [1.0.4] - 2023-08-22

### Allow creation of VectorCAST tests from test editors
- A "flask" icon is displayed for each function or method that is testable. 
- To create a new test, right click on the icon and choose: "Add VectorCAST Test"

### Bug Fixes
- Fixed issue: Auto completion not working properly in some cases #9
- Fixed issue: VectorCAST context menu is incorrectly added to non VectorCAST nodes #11
- Fixed test tree update issue: that caused the test tree to not update after a load or delete action.  Caused by the VS Code 1.81 release.

## [1.0.5] - 2023-09-14

- Added "Programming Languages" to the "categories" in the manifest so that the extension will get suggested for .tst files.

### Bug Fixes
- Fixed issue: Hover over for anonymous structs and unions show internal type names #17
- Fixed stack trace display when VectorCAST environment version is incompatible with VectorCAST installation


## [1.0.6] - 2023-10-04

### Bug Fixes
- Fixed issue:  New test scripts should have TEST.NEW not TEST.REPLACE #20
- Fixed issue:  Added ENVIRO.STUB: ALL_BY_PROTOTYPE to environment script #21
- Fixed issue:  Execute error when enviro at root of workspace #22

## [1.0.7] - 2023-10-06

### Bug Fixes
- Fixed issue: Do not overwrite an existing `CCAST_.CFG` if one exists #25

## [1.0.8] - 2023-10-06

- Added new right click menu choices for .vce (open environment) and .env (build environment) files #30
- Added new right click menu choice for test explorer tree to allow you to insert Basis Path and ATG tests #31
    - Addded Generate ATG and Generate Basis Path choices to the "flask+" icons in the text editor
- Added support for TEST.REQUIREMENT_KEY syntax, including a hover-over that displays the requirement text #34
- Improved the 'open settings' feature to default to the 'Workspace' tab

### Bug Fixes
- Fixed issue: Add flexibility to environment creation #26
- Fixed issue: Cleanup of temporary VectorCAST files #27
- Fixed issue: Inconsistent activation of the extension #28
- Fixed Issue: 'Delete Test' not working for environment, unit, and subprogram tree nodes #41
