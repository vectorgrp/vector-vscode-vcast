- To run the vitest-based unit tests, run `npm test` in the root of the repository.
  - Coverage info is found under `coverage/index.html` in the root of the repository.
  - VectorCAST test environment which is created for running the unit tests is `tests/unit/vcast`

- vmock-example has source files to test the coded mock features

- To run the vcast data sever tests, proceed as follows
  - Set VECTORCAST_DIR - Path to the installation vc24sp4+
  - Start the server using something like: vpython c:\rds\vector-vscode-vcast\python\vcastDataServer.py
  - Run the client using something like: vpython c:\rds\vector-vscode-vcast\tests\clicast-server\client.py

