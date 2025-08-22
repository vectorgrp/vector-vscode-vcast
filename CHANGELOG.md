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

## [1.0.8] - 2023-11-15

- Added new right click menu choices for .vce (open environment) and .env (build environment) files #30
- Added new right click menu choice for test explorer tree to allow you to insert Basis Path and ATG tests #31
    - Added Generate ATG and Generate Basis Path choices to the "flask+" icons in the text editor
- Added support for TEST.REQUIREMENT_KEY syntax, including a hover-over that displays the requirement text #34
- Improved the 'open settings' feature to default to the 'Workspace' tab

### Bug Fixes
- Fixed issue: Add flexibility to environment creation #26
- Fixed issue: Cleanup of temporary VectorCAST files #27
- Fixed issue: Inconsistent activation of the extension #28
- Fixed Issue: 'Delete Test' not working for environment, unit, and subprogram tree nodes #41

## [1.0.9] - 2023-12-12

### Bug Fixes
- Fixed issue: Non testable function showing up in the test pane, and have flask icon in editor #12 #44
- Fixed issue: Improper handling of enviro builder exit code #50

## [1.0.10] - 2024-02-29

- Improved messages shown during ATG test generation to remove extra LF 
- Added support for VectorCAST Coded Tests - see README.md for complete information

### Bug Fixes
- Fixed bug with create environment when VectorCAST installation cannot be found #58
- Improved validation of VectorCAST installation option #61
- Improved colors for expected values in execution reports #64
- Added support for test script option IGNORE_NAME_VALUE_ERRORS #57
- Fixed bug with right click .env to build environment #67

## [1.0.11] - 2024-06-21
- Improved color scheme for stdout/stderr from driver in execution reports
- Rearranged the extension options into General, and Build Environment section
- Added a new extension option for Coverage Kind to the Build Options
- Added support for environment variables in the Unit include path #96
- Forced Coded Tests entry in the test tree to be the first item in the function list

### Code Maintenance

- Ran Prettier and xo linter on typescript files, and Black on Python files
- Added package-lock.json files which fixes some issues with non-deterministic test results
- Major code re-organization to improve flow and logical grouping
- Removed launch.json from the repo, and added a launch.json.example

### Bug Fixes
- Improved validation of Unit Test Location option #76
- Handle the existing of "locked directories" in the Workspace #81
- Added support for JSON-C for VS Code files: launch.json, settings.json etc. #78
- Added support for relative paths to the coded test file in test script #106
- Fixed issue with unrecoverable link error after a coded test compile error #128

## [1.0.12] - 2024-09-25
- Added support for coded mocks.  See README section: "Editing a Coded Test" for usage details.
- Enforced a minium VectorCAST version: 21, and added notification to user for older versions

### Bug Fixes
- Removed an instance where the VectorCAST version mismatch error was displayed in the output pane #143.
- Fixed issue with the Test Pane not populating properly in some cases #149.
- The extension now ignores environment directories that are opened directly #173.
- Fixed an unnecessary update occurring during the insertion of ATG tests

## [1.0.13] - 2024-11-15
- Added support for utilising VectorCAST in server mode. See README section: "VectorCAST Data Server" for usage details.

### Bug Fixes
- Improved coverage status bar messages (#211)
- Execution reports no longer generate text reports (#220) and now use a custom report (#231)

### Code Maintenance
- `vsce` is now installed locally (from vector-vscode-vcast's `package.json`) and not globally (#196)

## [1.0.14] - 2024-11-19

### Bug Fixes
- Fix hover colours execution reports (#236)
- Fix View Test Results context menu (#237)

## [1.0.15] - 2024-12-20
- Implemented MCDC and MCDC+Statement Coverage (#243)
- Added ability to generate MCDC reports 

### Bug Fixes
- Fixed wrong Test Results message log (#248)

## [1.0.16] - 2025-05-20
- Implemented Manage support (#253), including:
    - **Environment Management**:  
        - Add existing environments to projects.  
        - Delete environments from a project.  
        - Create environments from source files.  
        - Build individual environments in isolation. 
        - Build / Execute Environments 
    - **Compiler Integration**:  
        - Create compiler instances from CFG configuration files.  
        - Remove compiler instances from the project.    
    - **Testsuite Handling**:  
        - Create and delete testsuites.  
        - Link and unlink environments to/from testsuites.  
        
- Implemented ability to load Test Scripts by saving the .tst file

## [1.0.17] - 2025-06-17

### Bug Fixes
- Fixed autocompletion for uut_prototype_stubs.


## [1.0.18] - 2025-08-15

- Added the ability to create a new Project
- Added the ability to create new Compilers in a Project.

### Code Maintenance
- Improved performance when initializing the extension


## [1.0.19] - 2025-08-22

### Bug Fixes
- Resolved path normalization issue when initializing environment data on Windows.