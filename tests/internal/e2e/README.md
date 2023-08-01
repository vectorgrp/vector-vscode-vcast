# How to run end-to-end (E2E) tests

## Configuring tests

Inside `internal/e2e/test/wdio.conf.ts`, we can specify some configuration parameters for end-to-end tests:

- VS-Code version to be used for testing the extension can be specified under `browserVersion` inside `capabilities:`. This version of VS-Code will automatically be downloaded before running the end-to-end tests. Per default, the end-to-end tests will run on currently "stable" version of VS-Code
- Proxy settings can be specified under `proxy:` inside `capabilities:`
    - "httpProxy" is set to be the same as `http_proxy` environment variable. When using a proxy, make sure this environment variable is set correctly or specify the proxy settings directly under `proxy:` inside `capabilities:`
    - In case no proxy is used, the respective entries can be removed
- Log level for the test framework is set to `error`, but can be configured under `logLevel`. These logs are saved under `e2e/trace`
- Under `mochaOpts` we can set `bail` to `true` if we want to stop the test execution as soon as one of the tests fails. 
- You can implement functionalities triggered by a test failure under `afterTest: function`. Currently, a screenshot of the GUI state during the test failure is taken and saved as `error_<test_name>.png`
- Configuration file will rely on `no_proxy` environment variable being set. In case of proxy-related issues (tests not starting), you can try setting `ALTERNATIVE_PROXY_HANDLING` to "True". This will enable the use of `bootstrap` from `global-agent`, as well as `Dispatcher` and `ProxyAgent` from `undici`

## Running end-to-end tests

### Prerequisites:

You should have `npm>=8.0` and `node>=16.9`. The following instructions were tested on `Ubuntu 20.04.4 LTS` with `npm==8.19.2` and `node==16.18.1`.

You must have VectorCAST installed and licensed, and the installation directory
must either be on the **system PATH**, or set using the extension option: **Vectorcast Installation Location**
During extension activation, the prerequisites will be checked, and any errors 
reported in the VectorCAST Test Explorer output pane.

You can check if VectorCAST is on your path by:

* open a shell, and type: which clicast

You also need to check that gcc is your path by:

* open a command prompt, and type: which gcc

Additionally, if you are using a version of VectorCAST that is older than
VectorCAST 23, you must manually add the crc32 utilities to your VectorCAST
install directory from this GitHub repo: https://github.com/vectorgrp/vector-vcast-crc32

### Running the tests:

**IMPORTANT**: It is recommended to run the tests in a separate Linux terminal, **Make sure all VS Code windows are closed before running the tests**. 
Make sure `VECTORCAST_DIR` points to your VectorCAST installation location.
If behind a corporate proxy: Make sure to set `NODE_EXTRA_CA_CERTS` to point to your certificate bundle.

1)  
    Install npm dependencies by running `npm install` inside `internal/e2e` folder

2) 
    Make sure the extension is built by running `vsce package` in the root of the repository
   
    The build script will create `vectorcasttestexplorer-<version>.vsix`, as well as `out/extension.js` and `out/server.js`. End-to-end tests are run directly on `out/extension.js` and `out/server.js`, together with necessary resources like `.svg` files.


3) 
    Inside `internal/e2e` folder, run ```npm test``` to execute end-to-end tests. 

    End-to-end tests are executed using `WebdriverIO` framework and its `wdio-vscode-service` ( https://webdriver.io/docs/wdio-vscode-service/ ). The `wdio-vscode-service` simplifies automating interactions with VS-Code UI and verifying the produced states. The interactions being tested will be logged to standard output. Tests take approximately 4 minutes to execute.

    Code for end-to-end tests can be found under `internal/e2e/test/specs/vcast.test.ts`. The tests are specified using `Mocha` framework.

### Viewing test results:
    
- Each test step is logged to standard output. 
- In case of a failing test, the failing assertion will be shown, including the line in `vcast.test.ts` where the failure ocurred. 
- For each of the tests, a screenshot of the GUI state during failure is made and saved in `internal/e2e` as `error in test <test_number>: <test_description>`

### Debugging tests:

1) Open `internal/e2e` in VS-Code 
2) Press `Ctrl + shift + P` to open command palette
3) Run `Debug: Toggle Auto attach`
4) Choose `Smart` as debug configuration. This will result in debugger only attaching to scripts that are not inside `node_modules` folder
5) Set breakpoints at desired locations in `internal/e2e/test/specs/vcast.test.ts` or `internal/e2e/test/test_utils/vcast_utils.ts`
6) Open a `JavaScript Debug Terminal` in `VS-Code`
7) Inside the opened terminal, navigate to `internal/e2e` and run ```npx wdio run test/wdio.conf.ts --spec ./test/specs/vcast.test.ts```

The `JavaScript Debugger` will automatically attach to the scripts being run and stop at any breakpoints previously added by user.

**Important**: Timeouts for test steps can be increased if needed for debug purposes. This can be done by setting `connectionTimeout` and `commandTimeout` in `e2e/wdio.conf.ts`

**Note**: It is advisable to **disable** `autoAttach`after finishing debugging, in order to avoid possible issues with `NODE_OPTIONS` environment variable being overwritten or deleted. `autoAttach` can be disabled by following the steps above and choosing `Disable` instead of `Smart` as debug configuration.
