# VectorCAST Test Explorer

This extension supports interacting with VectorCAST/C++ test
environments using the VS Code Test Explorer, as well as displaying code coverage
as a gutter decoration in C/C++ source editors.

## Prerequisites

You must have VectorCAST installed and licensed, and the installation directory
must be on the **system PATH**, set using the VECTORCAST_DIR environment variable
or set using the extension option: **Vectorcast Installation Location**.
During extension activation, the prerequisites will be checked, and any errors
reported in the VectorCAST Test Explorer output panel.

You can check if VectorCAST is on your path by:

- Linux: open a shell, and type: which clicast
- Windows: open a command prompt, and type: where clicast

You can check if VECTORCAST_DIR is set properly by:

- Linux: open a shell, and type: ls $VECTORCAST_DIR/clicast
- Windows: open a command prompt, and type: dir %VECTORCAST_DIR%\clicast

Additionally, if you are using a version of VectorCAST that is older than
VectorCAST 23, you must manually add the crc32 utilities to your VectorCAST
install directory from this GitHub repo: https://github.com/vectorgrp/vector-vcast-crc32.

## Usage

This extension extends the VS Code Test Explorer.

To use the extension, open a folder that contains one or more VectorCAST
test environments, and click on the Test Explorer "Flask" icon in the activity bar to
open the VS Code Test Explorer pane.  Within a few seconds a list of VectorCAST test 
environments will be displayed with a list of units, functions, and tests for each environment.

If your workspace does not contain any VectorCAST test environments, you can start testing
by right clicking on any C or C++ file in the explorer tree, and choosing "Create VectorCAST Environment".
This action will automatically activate the extension, and start the environment build process.

A final option to manually activate the extension without building an environment, is to choose
the "VectorCAST Test Explorer: Configure" from the command palette.
(Use: ctrl-shift-p or View->Command Palette to access).

Once the extension is activated, you will be able to use the following features:

## Features

Many of the features implemented by this extension are common to the VS Code test explorer.
The following sub-sections focus on features that are unique to the VectorCAST Test Explorer.


### The VectorCAST Configuration File

Before you can build a test environment, you must create a VectorCAST configuration file which allows
you to choose the compiler you're using, default search directories, and many other tool options.
The easiest way to do this is to set the extension option: "Configuration Location" to point to an existing 
CCAST_.CFG file.  To make setting this value easier, you may right click on any existing CCAST_.CFG
file and choose: "Set as VectorCAST Configuration File"

If this option is not set, and you attempt to build an environment, the extension will automatically 
open the VectorCASTgraphical option editor.

### Creating a New Test Environment

To create a new test environment, simply select one or more C/C++ files (.c, .cpp, .cxx, .cc)
from the File Explorer view, right click, and select: Create VectorCAST Environment.
The new test environment will be created in the location set via the extension
setting: "Unit Test Location". By default, this settings value is "./unitTests" which means
that the environment will be created in the "./unitTests" sub-directory of the directory
containing the source file.

### Coded Testing Support

If you would like to use the Coded Tests feature (VectorCAST 24 and newer), you must 
set the "Enable Coded Tests" extension option before building an environment.

### Test Explorer Icons

- The Log icon will open the VectorCAST Test Explorer message panel
- The Gear icon will open the VectorCAST Test Explorer settings

### The Test Tree

The VectorCAST Test Tree contains a hierarchy of nodes for each VectorCAST Test Environment.
The top-level node will indicate the relative path from the workspace root to the
environment. The subsequent levels show units, functions, and test cases.

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

#### Coded test context menu

If an environment was built with Coded Testing Support enabled (VectorCAST 24 and newer)
The right click context menu for all Coded Test nodes will have a VectorCAST sub-menu with the following commands:

- For a Coded Tests node with no existing tests
  - Add Existing Coded Test File - add an existing coded test source file to the node
  - Generate New Coded Test File - generate a new coded test source file for the node
- For a coded Tests node with existing tests
  - Remove Coded Tests - will remove the coded test file from the node.  The test file will NOT be deleted


### The "Flask+" Icon

Special "Flask+" icons are displayed in the margin of the text editor for all VectorCAST
testable functions.  This right click menu provides the ability to create a new test script, or
generate Basis Path or ATG tests for a single function.

### Creating a New Test Script

To create a new test, right click on a unit or function node and choose: "New Test Script"
from the VectorCAST right-click context menu, or right clicking on the "flask+" icon, and 
choose: "New Test Script"

### Auto-generated Test Cases

To insert Basis Path or ATG test cases for an environment, unit, or function, click on the 
appropriate node, and choose: "Insert Basis Path Tests" or "Insert ATG Tests", or right click 
the "flask+" icon and choose "Generate Basis Path Tests" or "Generate ATG Tests".

In both cases, a progress dialog will be display as the test cases are computed.

Note that the "ATG tests" menu is only available if you are using version of VectorCAST 23sp5 and higher.

### Editing an Existing Test Script

To edit an existing test script, right click on an environment, unit, function, or test node
and choose: "Edit Test Script" from the VectorCAST right-click context menu

### Test Script Editing Features

The extension provides Language Sensitive Editing (LSE) features to support the VectorCAST Test Script syntax.
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
editor window to load the test script into the VectorCAST test environment. If there are unsaved changes,
the load command will also perform a save.

### Coded Test Include File

Coded test files require an include like this: #include <vunit/vunit.h> so for IntelliSense editing to 
work nicely for coded test files, you must add an include path to for this file to your workspace.
IntelliSense include paths can most easily be added to the appropriate c_cpp_properties.json file.

If you enable the VectorCAST test explorer and configure it with a VectorCAST version that supports coded testing, 
the extension will check for the existence of the correct include path and prompt you to add it if it is not found.  

You can create a new c_cpp_properties file, by using the: 'C/C++: Edit Configurations (JSON)' command, and can 
easily add the required include path, by right clicking on a new or existing file, and choosing: "VectorCAST: Add Coded Test Include Path"

Here is an example a c_cpp_properties.json file with the vUnit include path added:

```
{
    "configurations": [
        {
            "name": "Win32",
            "includePath": [
                "${workspaceFolder}/**",
                "C:/VectorCAST/vunit/include"
            ],
            ...
```

### Editing a Coded Test 

Much of what you will do with Coded Test editing will use normal C++ syntax and as a result will be 
supported by the C/C++ language extension.  Because of the more involved syntax required for mocking
the extension supports some IntelliSense features dedicated to mocking.

Specifically, to easily define a mock for a function you simply need to use the auto-complete feature
for mocking to select the file (unit) and function, and the extension will do the rest.

To trigger this feature, just type: "// vmock ", and the extension will display a list of units that are
valid for the environment associated with the current coded test file.  After the unit is selected, typing 
another space will display all possible functions and methods that can be stubbed.  As is common with 
IntelliSense, if you type a few characters after the list is displayed, the editor will filter to choices 
containing those characters.

After selecting a function or method to be stubbed, the editor will provide the complete stub declaration as well
as the "usage line" hint for what you need to include in your VTEST.  

Assume you have a file called: "myFile.cpp" and a function called: "foo()" defined like this:  

```
int foo (int param) {
  return param;
  }
```

Proceed as follows when creating a coded test:
- type: // vmock <space> and choose myFile form the list of units
- type <space> and choose foo() as the function to stub
- type <space> to get the full declaration and a usage note.

Which will look like this:

```
// vmock foo foo 
int vmock_foo_foo(::vunit::CallCtx<> vunit_ctx, int param) {  
  
  // Enable Stub:  vmock_session.mock (&foo).assign (&vmock_foo_foo);
  // Disable Stub: vmock_session.mock (&foo).assign (nullptr);

}
```

You can then edit the mock logic to insert a hard-coded return of 100
and use the Usage hint to create a test like this:

```
VTEST(fooTests, simpleTest) {
  auto vmock_session = ::vunit::MockSession();
  vmock_session.mock (&foo).assign (&vmock_foo_foo);
  VASSERT_EQ (foo(1), 100);
}
```

Note: This feature is only supported for tool and environment version that are newer than VectorCAST 24 sp3.
If you type "// vmock" in a file associated with ane enviornment that was built with an older version
of VectorCAST, you will get the diagnostic message:  

  "This environment does not support mocks, no auto-completion is available",


Note: The extension will also auto-complete the: "auto vmock_session =" line

### Code Coverage Annotations

By default, the extension will display VectorCAST coverage data using green and red bars in the gutter
of any file that has code coverage data, and will show the x/y code coverage % in the status bar.

This feature can be toggled ON and OFF using the command: "VectorCAST Test Explorer: Toggle coverage annotations"
from the command palette, or using the shortcut ctrl-shift-c.

Note: partial coverage will not be shown, and for MC/DC, only the top level condition will be annotated

### Test Case Debugging

The extension supports debugging VectorCAST tests via the right click Test Context menu or icon.
Debugging requires a special launch configuration called: VectorCAST Harness Debug, which can be
installed by right clicking on any existing launch.json file in your workspace,
and choosing: "VectorCAST: Add Launch Config"

When you select "debug" for a test, the extension will prepare the VectorCAST environment for debugging,
open the VectorCAST version of the source file for the unit under test, and scroll the file to the
start of the function being tested.

You then simply need to set a breakpoint and use F5 to start the debugger.

### Miscellaneous Features

If you would like to exclude the VectorCAST internal files from your file explorer view, you can
do so by right clicking on the settings.json for the workspace and choosing:
'VectorCAST: Add Filter for Environment Files'. This will add the patterns for all of the
temporary VectorCAST files to the 'files.exclude' list.

To open and close the extension-specific message panel, use ctrl-shift-v

## Extension Commands

This extension contributes the following settings:

- "VectorCAST Test Explorer: View message panel" opens the VectorCAST Test Explorer output panel
- "VectorCAST Test Explorer: Refresh tests" re-scans the workspace for Vector tests
- "VectorCAST Test Explorer: Toggle coverage annotations" toggles the coverage annotations on/off (ctrl-shift-c)

## Extension Settings

This extension contributes the following general settings:

- "VectorCAST Installation Location" provides the path to the VectorCAST installation
- "Unit Test Location" controls where the extension stores unit test new unit test artifacts.
- "Configuration Location" control where the extension looks for the VectorCAST CCAST_.CFG file
- "Show Report on Execute" will show the HTML test report in after each VectorCAST test run.
- "Decorate Explorer Tree" will add a VC in the right margin of the file explorer tree for those files that have VectorCAST coverage.
- "Verbose Logging" will add more detailed messages to the VectorCAST Test Explorer message panel

And the following build settings

If you change a build setting, and rebuild an existing environment, the new build settings will be used
to update that environment.  For example, if you change the coverage kind to "Statement+Branch" 
that coverage kind will be active after the re-build action.

- "Enable Coded Tests" enables coded testing when new environments are built or re-built
- "Coverage Kind" sets the coverage kind for when environments are are built or re-built


## Known Issues

- If a VectorCAST configuration file (CCAST_.CFG) does not exist in the directory chosen
  via the "Unit Test Location" extension option, we default to the GNU compiler.
  If you are not using GNU, you must use VectorCAST to create a configuration file,
  before building a new environment
- Debugging is only supported for GNU compilers
- LSE features for Class Instances have not yet been implemented
- LSE features for TEST.FLOW have not been implemented
- Deleting a test does not remove the TC annotations in the File Explorer view
- [Open issues from GitHub](https://github.com/vectorgrp/vector-vscode-vcast/issues)

## Contributing

This extension is open-source, released under the MIT license, and we welcome your contributions.

- [Access the source repository on the Vector Group public GitHub](https://github.com/vectorgrp/vector-vscode-vcast)
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
