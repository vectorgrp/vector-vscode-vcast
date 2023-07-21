# VectorCAST Test Explorer

This extension supports interacting with VectorCAST/C++ test
environments using the Test Explorer UI, as well as displaying code coverage
as a margin decoration in C/C++ source editors.

## Prerequisites

You must have VectorCAST installed and licensed, and the installation directory
must either be on the **system PATH**, or set using the extension option: **VCAST Installation Location**
During extension activation, the prerequisites will be checked, and any errors
reported in the VectorCAST Test Explorer output pane.

You can check if VectorCAST is on your path by:

- Linux: open a shell, and type: which clicast
- Windows: open a command prompt, and type: where clicast

Additionally, if you are using a version of VectorCAST that is older than
VectorCAST 23, you must manually add the crc32 utilities to your VectorCAST
install directory from this GitHub repo: https://github.com/vectorgrp/vector-vcast-crc32

## Usage

This extension extends the VS Code Test Explorer.

To use the extension, just open a folder that contains one or more VectorCAST
test environments, then click on the Test Explorer "Flask" icon in the activity bar.
Within a few seconds a list of test environments will be displayed with a list
of units and functions that have test cases.

If you want to initialize a workspace or folder for VectorCAST testing, simply
run the command: "VectorCAST Test Explorer: Configure" from the command palette
(Use: ctrl-shift-p or View->Command Palette to access), or click on the "Flask"
button, and then click "Configure VectorCAST Tests"

Once the extension is configured, you will be able to use the following features

## Features

Many of the features implemented by this extension are common to the VS Code test explorer.
The following sub-sections focus on features that are unique to the VectorCAST Test Explorer.

### Creating a New Test Environment

To create a new test environment, simply select one or more C/C++ files (.c, .cpp, .cxx, .cc)
from the File Explorer pane, right click, and select: Create VectorCAST Environment.
The new test environment will be created in the location set via the extension
setting: "Unit Test Location". By default, this settings value is "./unitTests" which means
the environment will be created in the "./unitTests" sub-directory of the directory
containing the source file.

### Test Panel Icons

- The Log icon will open the VectorCAST Test Explorer message pane
- The Gear icon will open the VectorCAST Test Explorer settings

### The Test Tree

The VectorCAST Test Tree contains a hierarchy of nodes for each VectorCAST Test Environment.
The top-level node will indicate the relative path from the workspace root to the
environment. The subsequent levels show units, functions, and then test cases.

### Test Tree Context Menus

#### Environment node context menu

The right click context menu for Environment nodes, has a VectorCAST sub-menu with the following commands:

- Open Environment - opens the environment in the VectorCAST GUI
- Update Environment - runs the command 'clicast environment update'
- Delete Environment - deletes this environment from the tree and on disk
- Edit Test Script - opens the test script for all existing tests

#### Unit, function, and test node context menu

The right click menu for unit, function, and test nodes has a VectorCAST sub-menu with the following commands:

- Edit Test Script - generates the test script for the environment, unit, subprogram,
  or test depending on the context and opens it in an editor window
- New Test Script - generates a new test script template
- Delete Test - deletes the selected test
- View Test Results - displays the latest Test Execution Report

### Creating a New Test

To create a new test, right click on a unit or function node and choose: "New Test Script"
from the VectorCAST right-click context menu

### Editing an Existing Test

To edit an existing test script, right click on an environment, unit, function, or test node
and choose: "Edit Test Script" from the VectorCAST right-click context menu

### Test Script Editing Features

The extension provides Language Sensitive Editing (LSE) feature to support the VectorCAST Test Script syntax.
The LSE features are activated, whenever the extension is active and a file with a '.tst' extension is opened in the editor.

You can easily create the framework for a new test by using the 'vcast-test' snippet.
Just type 'vcast-test' anywhere in the '.tst' file, and then return, and the minimum commands to create a test will be inserted

To add a single script line, type TEST. and a list of all possible commands will be displayed.

A very helpful LSE features is auto-completion for TEST.VALUE and TEST.EXPECTED lines.
Type TEST.VALUE:, to see a list of all possible unit names, then a dot to see a list of  
function names for that unit. Subsequent dots will show the parameter and fields names.

The LSE features make it quick and intuitive to create new VectorCAST test scripts.

### Test Script Importing

When editing a test script file, a "Load Test Script into Environment" right click menu item is available in the
editor pane to load the test script into the VectorCAST test environment. If there are unsaved changes,
the load command will also perform a save.

### Code Coverage Annotations

By default, the extension will display VectorCAST coverage data using green and red bars in the gutter
of any file that has code coverage data, and will show the x/y code coverage % in the status bar.

This feature can be toggled ON and OFF using the command: "VectorCAST Test Explorer: Toggle coverage annotations"
from the command palette, or using the shortcut ctrl-shift-c.

### Test Case Debugging

The extension supports debugging VectorCAST tests via the right click Test Context menu or icon.
Debugging requires a special launch configuration called: VectorCAST Harness Debug, which can be
installed by right clicking on any existing launch.json file in your workspace,
and choosing: "VectorCAST Add Launch Config"

When you select "debug" for a test, the extension will prepare the VectorCAST environment for debugging,
open the VectorCAST version of the source file for the unit under test, and scroll the file to the
start of the function being tested.

You then simply need to set a breakpoint and use F5 to start the debugger.

### Miscellaneous Features

If you would like to exclude the VectorCAST internal files from your file explorer view, you can
do so by right clicking on the settings.json for the workspace and choosing:
'VectorCAST: Add Filter for Environment Files'. This will add the patterns for all of the
temporary VectorCAST files to the 'files.exclude' list.

To open and close the extension-specific message pane, use ctrl-shift-v

## Extension Commands

This extension contributes the following settings:

- "VectorCAST Test Explorer: View message pane" opens the VectorCAST Test Explorer output pane
- "VectorCAST Test Explorer: Refresh tests" re-scans the workspace for Vector tests
- "VectorCAST Test Explorer: Toggle coverage annotations" toggles the coverage annotations on/off (ctrl-shift-c)

## Extension Settings

This extension contributes the following settings:

- "VectorCAST Installation Location" provides the path to the VectorCAST installation
- "Show Report on Execute" will show the HTML test report in after each VectorCAST test run.
- "Decorate Explorer Tree" will add a VC in the right margin of the file explorer tree for those files that have VectorCAST coverage.
- "Unit Test Location" controls where the extension stores unit test new unit test artifacts.
- "Verbose Logging" will add more detailed messages to the VectorCAST Test Explorer message pane

## Known Issues

- If a VectorCAST configuration file (CCAST\_.CFG) does not exist in the directory chosen
  via the "Unit Test Location" extension option, we default to the GNU compiler.
  If you are not using GNU, you must use VectorCAST to create a configuration file,
  before building a new environment
- Debugging is only supported for GNU compilers
- LSE features for Class Instances have not yet been implemented
- LSE featrures for TEST.FLOW have not been implemented
- Deleting a test does not remove the TC annotations in the File Explorer pane

## Contributing

This extension is open-source, released under the MIT license, and we welcome your contributions.

- [Access the source repository on the Vector Group public GitHub](https://github.com/vectorgrp/vector-vscode-vtypecheck)
- [Submit Bugs and Feature Requests](https://github.com/vectorgrp/vector-vscode-vcast/issues)
- Implement improvements and [create a pull request](https://github.com/vectorgrp/vector-vscode-vcast/pulls)

- To install the dependencies necessary for building VectorCAST Test Explorer, run `npm install` in the root of the repository.
- Make sure you have `vsce` installed globally
  - To install `vsce`, run `npm install -g @vscode/vsce@^2.15.0`
- To build VectorCAST Test Explorer, run `vsce package` in the root of the repository
- To run existing unit tests for VectorCAST Test Explorer, run `npm test` in the root of the repository
  - Code and resources for unit tests can be found in `tests/unit`
- To run end-to-end tests (the end-to-end tests are meant for Vector internal usage):
  - If behind a corporate proxy, point `NODE_EXTRA_CA_CERTS` to your certificate bundle
  - Make sure you had built the extension already (run `vsce package` to build the extension)
  - Run `npm install` in `tests/internal/e2e` to install necessary dependencies
  - Run `npm test` in `tests/internal/e2e` to run the end-to-end tests
  - More detailed instructions can be found in `tests/internal/e2e`
   

## License

Copyright (c) Vector Informatik GmbH

Licensed under the [MIT](LICENSE.txt) license
