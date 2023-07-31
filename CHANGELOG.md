# Change Log

All notable changes to the "vectorcastTestExplorer" extension will be documented in this file.

## Initial Release

- 1.0.0 - Initial Release
- 1.0.1 - Fixed repository link in README.md

## [1.0.2] - 2023-08-01

### Added support for VECTORCAST_DIR
The VectorCAST instllation location can now be provided to the extension using one of the following 3 methods,
and will be checked for by the extension in the following order
- The path set in the extension option **Vcast Installation Location**
- The path set via the VECTORCAST_DIR environment variable
- The system PATH
