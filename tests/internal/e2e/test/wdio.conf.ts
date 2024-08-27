// Only using global-agent and GlobalDispatcher
// if running on vistr server
import path from "node:path";
import { URL } from "node:url";
import { exec } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  type ProxyTypes,
  type ProxyObject,
} from "@wdio/types/build/Capabilities";
import {
  getGlobalDispatcher,
  setGlobalDispatcher,
  Dispatcher,
  ProxyAgent,
} from "undici";
import { bootstrap } from "global-agent";
import type { Options } from "@wdio/types";
import capabilitiesJson from "./capabilityConfig.json";
import { getSpecs, removeReleaseOnPath } from "./specs_config.ts";

const noProxyRules = (process.env.no_proxy ?? "")
  .split(",")
  .map((rule) => rule.trim());
if (
  process.env.RUNNING_ON_SERVER === "True" ||
  process.env.GITHUB_ACTIONS === "true"
) {
  bootstrap();
  const proxyAgents = Object.fromEntries(
    ["http", "https"].map((protocol) => {
      const uri = process.env[`${protocol}_proxy`];
      if (uri) {
        return [`${protocol}:`, new ProxyAgent(uri)];
      }

      return [];
    })
  );
  const defaultDispatcher = getGlobalDispatcher();

  setGlobalDispatcher(
    new (class extends Dispatcher {
      dispatch(options, handler) {
        if (options.origin) {
          const { host, protocol } =
            typeof options.origin === "string"
              ? new URL(options.origin)
              : options.origin;
          if (
            !noProxyRules.some((rule) =>
              rule.startsWith(process.env.INIT_CWD)
                ? host.endsWith(rule)
                : host === rule
            )
          ) {
            const proxyAgent = proxyAgents[protocol];
            if (proxyAgent) {
              proxyAgent.dispatch(options, handler);
            }
          }
        }

        return defaultDispatcher.dispatch(options, handler);
      }
    })()
  );
}

const proxyType: ProxyTypes = "manual";
const proxyObject: ProxyObject = {
  proxyType,
  ftpProxy: process.env.http_proxy,
  httpProxy: process.env.http_proxy,
  noProxy: noProxyRules,
};
const groupName =
  process.env.RUN_BY_GROUP === "True" ? process.env.RUN_GROUP_NAME : null;

export const config: Options.Testrunner = {
  //
  // ====================
  // Runner Configuration
  // ====================
  //
  //
  // =====================
  // ts-node Configurations
  // =====================
  //
  // You can write tests using TypeScript to get autocompletion and type safety.
  // You will need typescript and ts-node installed as devDependencies.
  // WebdriverIO will automatically detect if these dependencies are installed
  // and will compile your config and tests for you.
  // If you need to configure how ts-node runs please use the
  // environment variables for ts-node or use wdio config"s autoCompileOpts section.
  //
  automationProtocol: "webdriver",
  headless: true,
  autoCompileOpts: {
    autoCompile: true,
    // See https://github.com/TypeStrong/ts-node#cli-and-programmatic-options
    // for all available options
    tsNodeOpts: {
      transpileOnly: true,
      project: "test/tsconfig.json",
    },
    // Tsconfig-paths is only used if "tsConfigPathsOpts" are provided, if you
    // do please make sure "tsconfig-paths" is installed as dependency
    // tsConfigPathsOpts: {
    //     baseUrl: "./"
    // }
  },
  //
  // ==================
  // Specify Test Files
  // ==================
  // Define which test specs should run. The pattern is relative to the directory
  // from which `wdio` was called.
  //
  // The specs are defined as an array of spec files (optionally using wildcards
  // that will be expanded). The test for each spec file will be run in a separate
  // worker process. In order to have a group of spec files run in the same worker
  // process simply enclose them in an array within the specs array.
  //
  // If you are calling `wdio` from an NPM script (see https://docs.npmjs.com/cli/run-script),
  // then the current working directory is where your `package.json` resides, so `wdio`
  // will be called from there.
  //
  specs: getSpecs(process.env.USE_VCAST_24 === "True", groupName),
  // Patterns to exclude.
  // exclude:
  //
  // ============
  // Capabilities
  // ============
  // Define your capabilities here. WebdriverIO can run multiple capabilities at the same
  // time. Depending on the number of capabilities, WebdriverIO launches several test
  // sessions. Within your capabilities you can overwrite the spec and exclude options in
  // order to group specific specs to a specific capability.
  //
  // First, you can define how many instances should be started at the same time. Let"s
  // say you have 3 different capabilities (Chrome, Firefox, and Safari) and you have
  // set maxInstances to 1; wdio will spawn 3 processes. Therefore, if you have 10 spec
  // files and you set maxInstances to 10, all spec files will get tested at the same time
  // and 30 processes will get spawned. The property handles how many capabilities
  // from the same test should run tests.
  //

  maxInstances: 1,
  outputDir: "./trace",
  //
  // If you have trouble getting all important capabilities together, check out the
  // Sauce Labs platform configurator - a great tool to configure your capabilities:
  // https://saucelabs.com/platform/platform-configurator
  //
  capabilities: [
    {
      // MaxInstances can get overwritten per capability. So if you have an in-house Selenium
      // grid with only 5 firefox instances available you can make sure that not more than
      // 5 instances get started at a time.
      maxInstances: capabilitiesJson.maxInstances,
      browserName: capabilitiesJson.browserName,
      proxy: proxyObject,
      browserVersion: capabilitiesJson.browserVersion,
      acceptInsecureCerts: capabilitiesJson.acceptInsecureCerts,
      "wdio:vscodeOptions": {
        extensionPath: path.join(__dirname, "extension"),
        workspacePath: path.join(__dirname, "vcastTutorial"),
        vscodeArgs: {
          disableExtensions: true,
          "local-history.enabled":
            capabilitiesJson["wdio:vscodeOptions"].vscodeArgs[
              "local-history.enabled"
            ],
        },
        verboseLogging: capabilitiesJson["wdio:vscodeOptions"].verboseLogging,
        userSettings: {
          "editor.fontSize":
            capabilitiesJson["wdio:vscodeOptions"].userSettings[
              "editor.fontSize"
            ],
          "terminal.integrated.fontSize":
            capabilitiesJson["wdio:vscodeOptions"].userSettings[
              "terminal.integrated.fontSize"
            ],
          "window.zoomLevel":
            capabilitiesJson["wdio:vscodeOptions"].userSettings[
              "window.zoomLevel"
            ],
        },
        vscodeProxyOptions: {
          enable:
            capabilitiesJson["wdio:vscodeOptions"].vscodeProxyOptions.enable,
          port: capabilitiesJson["wdio:vscodeOptions"].vscodeProxyOptions.port,
          connectionTimeout:
            capabilitiesJson["wdio:vscodeOptions"].vscodeProxyOptions
              .connectionTimeout,
          commandTimeout:
            capabilitiesJson["wdio:vscodeOptions"].vscodeProxyOptions
              .commandTimeout,
        },
      },
    },
  ],
  //
  // ===================
  // Test Configurations
  // ===================
  // Define all options that are relevant for the WebdriverIO instance here
  //
  // Level of logging verbosity: trace | debug | info | warn | error | silent
  logLevel: "error",
  //
  // Set specific log levels per logger
  // loggers:
  // - webdriver, webdriverio
  // - @wdio/browserstack-service, @wdio/devtools-service, @wdio/sauce-service
  // - @wdio/mocha-framework, @wdio/jasmine-framework
  // - @wdio/local-runner
  // - @wdio/sumologic-reporter
  // - @wdio/cli, @wdio/config, @wdio/utils
  // Level of logging verbosity: trace | debug | info | warn | error | silent
  // logLevels: {
  //     webdriver: "info",
  //     "@wdio/appium-service": "info"
  // },
  //
  // If you only want to run your tests until a specific amount of tests have failed use
  // bail (default is 0 - don"t bail, run all tests).
  bail: 1,
  //
  // Set a base URL in order to shorten url command calls. If your `url` parameter starts
  // with `/`, the base url gets prepended, not including the path portion of your baseUrl.
  // If your `url` parameter starts without a scheme or `/` (like `some/path`), the base url
  // gets prepended directly.
  baseUrl: "http://localhost",
  //
  // Default timeout for all waitFor* commands.
  waitforTimeout: 30_000,
  //
  // Default timeout in milliseconds for request
  // if browser driver or grid doesn"t send response
  connectionRetryTimeout: 22_000,
  //
  // Default request retries count
  connectionRetryCount: 2,
  //
  // Test runner services
  // Services take over a specific job you don"t want to take care of. They enhance
  // your test setup with almost no effort. Unlike plugins, they don"t add new
  // commands. Instead, they hook themselves up into the test process.
  services: ["vscode"],
  // Framework you want to run your specs with.
  // The following are supported: Mocha, Jasmine, and Cucumber
  // see also: https://webdriver.io/docs/frameworks
  //
  // Make sure you have the wdio adapter package for the specific framework installed
  // before running any tests.
  framework: "mocha",
  //
  // The number of times to retry the entire specfile when it fails as a whole
  // specFileRetries: 1,
  //
  // Delay in seconds between the spec file retry attempts
  // specFileRetriesDelay: 0,
  //
  // Whether or not retried specfiles should be retried immediately or deferred to the end of the queue
  // specFileRetriesDeferred: false,
  //
  // Test reporter for stdout.
  // The only one supported by default is "dot"
  // see also: https://webdriver.io/docs/dot-reporter
  reporters: [
    "spec",
    [
      "junit",
      {
        outputDir: "test_results",
        outputFileFormat(options) {
          // Optional
          return `results-${options.cid}.xml`;
        },
      },
    ],
  ],

  //
  // Options to be passed to Mocha.
  // See the full list at http://mochajs.org/
  mochaOpts: {
    ui: "bdd",
    timeout: 1_200_000,
    bail: true,
  },
  //
  // =====
  // Hooks
  // =====
  // WebdriverIO provides several hooks you can use to interfere with the test process in order to enhance
  // it and to build services around it. You can either apply a single function or an array of
  // methods to it. If one of them returns with a promise, WebdriverIO will wait until that promise got
  // resolved to continue.
  /**
   * Gets executed once before all workers get launched.
   * @param {Object} config wdio configuration object
   * @param {Array.<Object>} capabilities list of capabilities details
   */
  async onPrepare(config, capabilities) {
    let vectorcastDir: string;
    let clicastExecutablePath: string;
    let testInputEnvPath: string;
    let codedTestsPath: string;

    const promisifiedExec = promisify(exec);

    const initialWorkdir = process.env.INIT_CWD;
    await setupTestEnvironment(initialWorkdir);

    // Lookup table for our environment variables and corresponding actions.
    // Each ENV flags a different test because it needs to be build differently.
    const envActions = new Map([
      ["BUILD_MULTIPLE_ENVS", async () => await setupMultipleEnvironments()],
      [
        "SWITCH_ENV_AT_THE_END",
        async () => await setupSingleEnvAndSwitchAtTheEnd(initialWorkdir),
      ],
    ]);

    // Determine the environment key
    const envKey = Array.from(envActions.keys()).find(
      (env) => process.env[env]
    );

    if (envKey) {
      // Execute the corresponding function if an environment variable is found
      await envActions.get(envKey)!();
    } else {
      // Default case if no matching environment variable is found
      await setupSingleEnvironment(initialWorkdir);
    }

    const extensionUnderTest = path.join(initialWorkdir, "test", "extension");
    await mkdir(extensionUnderTest, { recursive: true });

    const repoRoot = path.join(".", "..", "..", "..");
    const foldersToCopy = [
      "images",
      "out",
      "python",
      "resources",
      "supportFiles",
      "syntax",
    ];

    if (process.platform == "win32") {
      foldersToCopy.forEach(async (folderName) => {
        const folderPath = path.join(repoRoot, folderName);
        await executeCommand(
          `xcopy /s /i /y ${folderPath} ${path.join(
            extensionUnderTest,
            folderName
          )} > NUL 2> NUL`
        );
        await executeCommand(
          `copy /y ${path.join(repoRoot, "package.json")} ${extensionUnderTest}`
        );
      });
    } else {
      foldersToCopy.forEach(async (folderName) => {
        const folderPath = path.join(repoRoot, folderName);
        await executeCommand(`cp -r ${folderPath} ${extensionUnderTest}`);
      });
      await executeCommand(
        `cp ${path.join(repoRoot, "package.json")} ${extensionUnderTest}`
      );
    }

    /**
     * ================================================================================================
     *                           INDIVIDUAL ENVIRONMENT SETUPS
     * ================================================================================================
     */

    /**
     * Builds one env based on VECTORCAST_DIR.
     * Standard env build and used by most Spec groups.
     */
    async function setupSingleEnvironment(initialWorkdir: string) {
      const testInputVcastTutorial = path.join(
        initialWorkdir,
        "test",
        "test_input",
        "vcastTutorial"
      );

      if (process.env.VECTORCAST_DIR) {
        // Standard setup when VECTORCAST_DIR is available
        await checkVPython();
        clicastExecutablePath = await checkClicast();
        process.env.CLICAST_PATH = clicastExecutablePath;

        await prepareConfig(initialWorkdir);
        const createCFG = `cd ${testInputVcastTutorial} && clicast -lc template GNU_CPP_X`;
        await executeCommand(createCFG);
      } else {
        // Alternative setup for VECTORCAST_DIR_TEST_DUPLICATE
        const currentPath = process.env.PATH || "";
        const newPath = path.join(
          process.env.VECTORCAST_DIR_TEST_DUPLICATE || "",
          "vpython"
        );
        process.env.PATH = `${newPath}${path.delimiter}${currentPath}`;
        clicastExecutablePath = `${process.env.VECTORCAST_DIR_TEST_DUPLICATE}/clicast`;
        process.env.CLICAST_PATH = clicastExecutablePath;

        await prepareConfig(initialWorkdir);
        const createCFG = `cd ${testInputVcastTutorial} && ${process.env.VECTORCAST_DIR_TEST_DUPLICATE}/clicast -lc template GNU_CPP_X`;
        await executeCommand(createCFG);
      }

      // Execute RGW commands and copy necessary files
      await executeRGWCommands(testInputVcastTutorial);
      await copyPathsToTestLocation(testInputVcastTutorial);
    }

    /**
     * Builds one env with 2024sp3 and switches to vc24__101394_store_mock_info at the end.
     * TARGET SPEC GROUP: coded_mock_different_env
     */
    async function setupSingleEnvAndSwitchAtTheEnd(initialWorkdir: string) {
      // Setup environment with clicast and vpython
      await checkVPython();
      clicastExecutablePath = await checkClicast();
      process.env.CLICAST_PATH = clicastExecutablePath;

      const workspacePath = path.join(__dirname, "vcastTutorial");
      const testInputVcastTutorial = path.join(
        initialWorkdir,
        "test",
        "test_input",
        "vcastTutorial"
      );

      let vcastRoot = await getVcastRoot();
      const oldVersion = "release24";
      const newVersion = "vc24__101394_store_mock_info";

      // Set up environment directory
      process.env.VECTORCAST_DIR = path.join(vcastRoot, oldVersion);
      await prepareConfig(initialWorkdir);

      // Execute environment configuration and run RGW commands
      const createCFG = `cd ${testInputVcastTutorial} && ${process.env.VECTORCAST_DIR}/clicast -lc template GNU_CPP_X`;
      await executeCommand(createCFG);

      await executeRGWCommands(testInputVcastTutorial);
      await copyPathsToTestLocation(testInputVcastTutorial);

      // Log that SWITCH_ENV_AT_THE_END is being defined
      console.log("SWITCH_ENV_AT_THE_END IS DEFINED");

      // Define paths and content for the necessary test files
      const unitFileContent = `void foo (void){}`;
      const unitFile = path.join(workspacePath, "moo.cpp");
      const testsFile = path.join(workspacePath, "tests.cpp");
      const testENVFile = path.join(workspacePath, "TEST.env");
      const templateFile = path.join(workspacePath, "template.tst");

      const testENVContent = `ENVIRO.NEW
ENVIRO.NAME: TEST
ENVIRO.BASE_DIRECTORY: VCAST_SourceRoot=.
ENVIRO.STUB_BY_FUNCTION: moo
ENVIRO.WHITE_BOX: NO
ENVIRO.VCDB_FILENAME: 
ENVIRO.VCDB_CMD_VERB: 
ENVIRO.COVERAGE_TYPE: Statement+Branch
ENVIRO.INDUSTRY_MODE: Default
ENVIRO.ADDITIONAL_STUB: VCAST_ATG_FP_0
ENVIRO.ADDITIONAL_STUB: VCAST_ATG_FP_1
ENVIRO.LIBRARY_STUBS:  
ENVIRO.STUB: ALL_BY_PROTOTYPE
ENVIRO.NOT_SUPPORTED_TYPE: asdsadsa
ENVIRO.COMPILER: CC
ENVIRO.TYPE_HANDLED_DIRS_ALLOWED: 
ENVIRO.UNIT_APPENDIX_USER_CODE:
ENVIRO.UNIT_APPENDIX_USER_CODE_FILE:fp_update
int VCAST_ATG_FP_1(int);
ENVIRO.END_UNIT_APPENDIX_USER_CODE_FILE:
ENVIRO.END_UNIT_APPENDIX_USER_CODE:

ENVIRO.SEARCH_LIST: $(VCAST_SourceRoot)/
ENVIRO.END`;

      const testsCPP = `#include <vunit/vunit.h>
namespace {
class mooFixture : public ::vunit::Fixture {
protected:
void SetUp(void) override {
  // Set up code goes here.
}

void TearDown(void) override {
  // Tear down code goes here.
}
};
} // namespace

VTEST(mooTests, ExampleTestCase) {
VASSERT(true);
}`;

      const templateContent = `-- Test Case: tests
TEST.UNIT:moo
TEST.SUBPROGRAM:coded_tests_driver
TEST.NEW
TEST.NAME:tests
TEST.CODED_TESTS_FILE:./tests.cpp
TEST.END`;

      // Write template and test files to disk
      await writeFile(templateFile, templateContent.trim());
      await writeFile(unitFile, unitFileContent);
      await writeFile(testsFile, testsCPP);
      await writeFile(testENVFile, testENVContent);

      // Revert VECTORCAST_DIR to the old version and execute setup commands
      process.env.VECTORCAST_DIR = path.join(vcastRoot, oldVersion);

      const setCoded = `cd ${workspacePath} && ${process.env.VECTORCAST_DIR}/clicast -lc option VCAST_CODED_TESTS_SUPPORT TRUE`;
      const setEnviro = `cd ${workspacePath} && ${process.env.VECTORCAST_DIR}/enviroedg TEST.env`;
      const runTest = `cd ${workspacePath} && ${process.env.VECTORCAST_DIR}/clicast -e TEST test script run template.tst`;

      await executeCommand(setCoded);
      await executeCommand(setEnviro);
      await executeCommand(runTest);

      // Switch to the new environment version
      process.env.VECTORCAST_DIR = path.join(vcastRoot, newVersion);
    }

    /**
     * Builds multiple envs for release 23 and release 24
     * TARGET SPEC GROUP: build_different_envs
     */
    async function setupMultipleEnvironments() {
      let vcastRoot = await getVcastRoot();

      const oldVersion = "release23";
      const newVersion = "release24";

      // Total amount of envs to be build
      const totalEnvCount = 4;

      const placeholder = "%%REPLACE%%";
      const unit = "unit";

      const workspacePath = path.join(__dirname, "vcastTutorial");
      const envTemplate = path.join(workspacePath, "TEST.template");
      const unitFile = path.join(workspacePath, "unit.cpp");

      const envTemplateContent = `
ENVIRO.NEW
ENVIRO.NAME: ${placeholder}
ENVIRO.STUB_BY_FUNCTION: ${unit}
ENVIRO.WHITE_BOX: NO
ENVIRO.VCDB_FILENAME:
ENVIRO.COVERAGE_TYPE: NONE
ENVIRO.LIBRARY_STUBS:
ENVIRO.STUB: ALL_BY_PROTOTYPE
ENVIRO.COMPILER: CC
ENVIRO.SEARCH_LIST: .
ENVIRO.END
`;

      // Write template and cpp to file
      await writeFile(envTemplate, envTemplateContent.trim());
      const unitFileContent = "void foo(void) {}";
      await writeFile(unitFile, unitFileContent);

      // Create correct dir for the tests
      await mkdir(workspacePath, { recursive: true });
      let envName: string;

      // Create envs and copy them to workspacePath
      for (let i = 1; i <= totalEnvCount; i++) {
        // Env for release 24
        if (i % 2 === 0) {
          envName = `ENV_24_${i.toString().padStart(2, "0")}`;
        } else {
          // Env for release 23
          envName = `ENV_23_${i.toString().padStart(2, "0")}`;
        }

        const envFile = path.join(workspacePath, `${envName}.env`);
        const envContent = (await readFile(envTemplate))
          .toString()
          .replace(placeholder, envName);
        await writeFile(envFile, envContent);
      }

      // Initial build with the old version
      process.env.VCAST_FORCE_OVERWRITE_ENV_DIR = "1";
      process.env.VECTORCAST_DIR = path.join(vcastRoot, oldVersion);

      const createCFG = `cd ${workspacePath} && ${process.env.VECTORCAST_DIR}/clicast -lc template GNU_CPP_X`;
      await executeCommand(createCFG);

      // Build environments based on the iteration index
      for (let i = 1; i <= totalEnvCount; i++) {
        let envName: string;
        // Switch VectorCAST version based on iteration (build 1,3 --> release 23, 2,4 --> release 24)
        if (i % 2 === 0) {
          process.env.VECTORCAST_DIR = path.join(vcastRoot, newVersion);
          envName = `ENV_24_${i.toString().padStart(2, "0")}`;
          console.log(`Building ${envName} with ${process.env.VECTORCAST_DIR}`);
        } else {
          process.env.VECTORCAST_DIR = path.join(vcastRoot, oldVersion);
          envName = `ENV_23_${i.toString().padStart(2, "0")}`;
          console.log(`Building ${envName} with ${process.env.VECTORCAST_DIR}`);
        }

        const envFile = path.join(workspacePath, `${envName}.env`);
        const buildEnv = `cd ${workspacePath} && ${process.env.VECTORCAST_DIR}/clicast -lc environment script run ${envFile}`;

        await executeCommand(buildEnv);
      }

      process.env.VECTORCAST_DIR = path.join(vcastRoot, oldVersion);

      // Clean up VSCode settings
      const vscodeDir = path.join(workspacePath, ".vscode");
      await rm(vscodeDir, { recursive: true, force: true });
      await mkdir(vscodeDir, { recursive: true });
    }

    /**
     * ================================================================================================
     *                              ENVIRONMENT SETUP HELPERS
     * ================================================================================================
     */

    /**
     * Cleans up and sets up the test environment directories.
     *
     * @param {string} initialWorkdir - The base directory path where test directories are located.
     * @returns {Promise<void>} - A promise that resolves when all directory operations are complete.
     */
    async function setupTestEnvironment(initialWorkdir: string): Promise<void> {
      const vcastTutorialPath = path.join(
        initialWorkdir,
        "test",
        "vcastTutorial"
      );
      await rm(vcastTutorialPath, { recursive: true, force: true });

      const logPath = path.join(initialWorkdir, "test", "log");
      await rm(logPath, { recursive: true, force: true });
      await mkdir(logPath, { recursive: true });

      await mkdir(vcastTutorialPath);
      const extensionPath = path.join(initialWorkdir, "test", "extension");
      await rm(extensionPath, { recursive: true, force: true });

      const testResultsPath = path.join(initialWorkdir, "test_results");
      await rm(testResultsPath, { recursive: true, force: true });

      process.env.WORKSPACE_FOLDER = "vcastTutorial";
    }

    /**
     * Prepares the execution of clicast and the creation of the CFG config file.
     *
     * @param initialWorkdir - Path of the initial work dir.
     * @returns {Promise<void>} - A promise that resolves when all preparation operations are complete.
     */
    async function prepareConfig(initialWorkdir: string): Promise<void> {
      // Set vectorcast directory based on CLICAST_PATH
      vectorcastDir = path.dirname(process.env.CLICAST_PATH);
      process.env.VC_DIR = vectorcastDir;

      // Clear any existing screenshots
      const clearScreenshots =
        process.platform == "win32" ? "del /s /q *.png" : "rm -rf *.png";
      await executeCommand(clearScreenshots);

      // Define paths for test input and directories
      const testInputVcastTutorial = path.join(
        initialWorkdir,
        "test",
        "test_input",
        "vcastTutorial"
      );

      testInputEnvPath = path.join(testInputVcastTutorial, "cpp");
      await mkdir(testInputEnvPath, { recursive: true });

      codedTestsPath = path.join(testInputVcastTutorial, "cpp", "TestFiles");
      await mkdir(codedTestsPath, { recursive: true });

      const vscodeSettingsPath = path.join(testInputVcastTutorial, ".vscode");
      await mkdir(vscodeSettingsPath, { recursive: true });

      // Create a launch.json file for VSCode
      const launchJsonPath = path.join(vscodeSettingsPath, "launch.json");
      const createLaunchJson =
        process.platform == "win32"
          ? `copy /b NUL ${launchJsonPath}`
          : `touch ${launchJsonPath}`;
      await executeCommand(createLaunchJson);

      const pathTovUnitInclude = path.join(vectorcastDir, "vunit", "include");
      const c_cpp_properties = {
        configurations: [
          {
            name: "Linux",
            includePath: ["${workspaceFolder}/**", `${pathTovUnitInclude}`],
            defines: [],
            compilerPath: "/usr/bin/clang",
            cStandard: "c17",
            cppStandard: "c++14",
            intelliSenseMode: "linux-clang-x64",
          },
        ],
        version: 4,
      };

      // Write IntelliSense configuration to c_cpp_properties.json
      const c_cpp_properties_JSON = JSON.stringify(c_cpp_properties, null, 4);
      const c_cpp_properties_JSONPath = path.join(
        vscodeSettingsPath,
        "c_cpp_properties.json"
      );
      await writeFile(c_cpp_properties_JSONPath, c_cpp_properties_JSON);

      const envFile = `ENVIRO.NEW
ENVIRO.NAME: DATABASE-MANAGER-test
ENVIRO.COVERAGE_TYPE: Statement
ENVIRO.WHITE_BOX: YES
ENVIRO.COMPILER: CC
ENVIRO.STUB: ALL_BY_PROTOTYPE
ENVIRO.SEARCH_LIST: cpp
ENVIRO.STUB_BY_FUNCTION: database
ENVIRO.STUB_BY_FUNCTION: manager
ENVIRO.END
      `;
      await writeFile(
        path.join(testInputVcastTutorial, "DATABASE-MANAGER-test.env"),
        envFile
      );
    }

    /**
     * Executes a given command and logs any errors that occur during execution.
     *
     * @param {string} command - The command to be executed.
     * @returns {Promise<void>} - A promise that resolves when the command has been executed or rejects if an error occurs.
     */
    async function executeCommand(command: string): Promise<void> {
      try {
        await promisifiedExec(command);
      } catch (error) {
        console.error(`Error executing command "${command}":`, error);
      }
    }

    /**
     * Copies various files and directories to a specified test location.
     *
     * @param testInputVcastTutorial - The path to the tutorial files that need to be copied to the test directory.
     * @returns {Promise<void>} - A promise that resolves when all copy operations are complete.
     */
    async function copyPathsToTestLocation(testInputVcastTutorial: string) {
      const pathToTutorial = path.join(vectorcastDir, "tutorial", "cpp");
      await mkdir(pathToTutorial, { recursive: true });
      const cppFilesToCopy = path.join(pathToTutorial, "*.cpp");
      const headerFilesToCopy = path.join(pathToTutorial, "*.h");

      const examplesDir = path.join(initialWorkdir, "test", "examples");
      const examplesToCopy = path.join(examplesDir, "*.cpp");
      const codedTestsExamplesToCopy = path.join(
        examplesDir,
        "coded_tests",
        "*.cpp"
      );

      // Copying didn't work with cp from fs
      if (process.platform == "win32") {
        await executeCommand(
          `xcopy /s /i /y ${examplesToCopy} ${testInputEnvPath} > NUL 2> NUL`
        );
        await executeCommand(
          `xcopy /s /i /y ${cppFilesToCopy} ${testInputEnvPath} > NUL 2> NUL`
        );
        await executeCommand(
          `xcopy /s /i /y ${headerFilesToCopy} ${testInputEnvPath} > NUL 2> NUL`
        );
        await executeCommand(
          `xcopy /s /i /y ${codedTestsExamplesToCopy} ${codedTestsPath} > NUL 2> NUL`
        );
        await executeCommand(
          `xcopy /s /i /y ${testInputVcastTutorial} ${path.join(
            initialWorkdir,
            "test",
            "vcastTutorial"
          )}`
        );
      } else {
        await executeCommand(`cp ${examplesToCopy} ${testInputEnvPath}`);
        await executeCommand(`cp ${cppFilesToCopy} ${testInputEnvPath}`);
        await executeCommand(`cp ${headerFilesToCopy} ${testInputEnvPath}`);
        await executeCommand(
          `cp ${codedTestsExamplesToCopy} ${codedTestsPath}`
        );
        await executeCommand(
          `cp -r ${testInputVcastTutorial} ${path.join(initialWorkdir, "test")}`
        );
      }
    }

    /**
     * Executes a series of RGW commands for initializing and configuring the RGW environment.
     *
     * @param testInputVcastTutorial - The path to the directory where the RGW commands will be executed.
     * @returns {Promise<void>} - A promise that resolves when all RGW commands have been executed successfully.
     * @throws {Error} - Throws an error if any of the commands fail during execution.
     */
    async function executeRGWCommands(testInputVcastTutorial: string) {
      const requestTutorialPath = path.join(
        vectorcastDir,
        "examples",
        "RequirementsGW",
        "CSV_Requirements_For_Tutorial.csv"
      );
      const commandPrefix = `cd ${testInputVcastTutorial} && ${process.env.CLICAST_PATH.trimEnd()} -lc`;

      const rgwPrepCommands = [
        `${commandPrefix} option VCAST_REPOSITORY ${path.join(
          initialWorkdir,
          "test",
          "vcastTutorial"
        )}`,
        `${commandPrefix} RGw INitialize`,
        `${commandPrefix} Rgw Set Gateway CSV`,
        `${commandPrefix} RGw Configure Set CSV csv_path ${requestTutorialPath}`,
        `${commandPrefix} RGw Configure Set CSV use_attribute_filter 0`,
        `${commandPrefix} RGw Configure Set CSV filter_attribute`,
        `${commandPrefix} RGw Configure Set CSV filter_attribute_value `,
        `${commandPrefix} RGw Configure Set CSV id_attribute ID`,
        `${commandPrefix} RGw Configure Set CSV key_attribute Key`,
        `${commandPrefix} RGw Configure Set CSV title_attribute Title `,
        `${commandPrefix} RGw Configure Set CSV description_attribute Description `,
        `${commandPrefix} RGw Import`,
      ];
      for (const rgwPrepCommand of rgwPrepCommands) {
        await executeCommand(rgwPrepCommand);
      }
    }

    /**
     * Checks if the `vpython` executable is available in the system's PATH.
     *
     * @throws {Error} - If `vpython` is not found or there is a command error.
     */
    async function checkVPython(): Promise<void> {
      let checkVPython =
        process.platform == "win32" ? "where vpython" : "which vpython";

      {
        const { stdout, stderr } = await promisifiedExec(checkVPython);
        if (stderr) {
          console.log(stderr);
          throw `Error when running ${checkVPython}`;
        } else {
          console.log(`vpython found in ${stdout}`);
        }
      }
    }

    /**
     * Checks if the `clicast` executable is available in the system's PATH.
     *
     * @returns {Promise<string>} - Path to the `clicast` executable.
     * @throws {Error} - If `clicast` is not found or there is a command error.
     */
    async function checkClicast(): Promise<string> {
      let checkClicast =
        process.platform == "win32" ? "where clicast" : "which clicast";

      {
        const { stdout, stderr } = await promisifiedExec(checkClicast);
        if (stderr) {
          console.log(stderr);
          throw `Error when running ${checkClicast}`;
        } else {
          console.log(`clicast found in ${stdout}`);
          return stdout;
        }
      }
    }

    /**
     * Checks the root dir of the vcast release.
     * Assuming that the root folder is locally on $HOME/vcast.
     *
     * @returns - Root dir of the vcast release, based on if the tests are executed on the CI or locally
     */
    async function getVcastRoot(): Promise<string> {
      let vcastRoot: string;

      // Check if we are on CI
      if (process.env.HOME.startsWith("/github")) {
        vcastRoot = "/vcast";
      } else {
        // Assuming that locally release is on this path.
        vcastRoot = path.join(process.env.HOME, "vcast");
      }
      return vcastRoot;
    }
  },
  /**
   * Gets executed before a worker process is spawned and can be used to initialise specific service
   * for that worker as well as modify runtime environments in an async fashion.
   * @param  {String} cid      capability id (e.g 0-0)
   * @param  {[type]} caps     object containing capabilities for session that will be spawn in the worker
   * @param  {[type]} specs    specs to be run in the worker process
   * @param  {[type]} args     object that will be merged with the main configuration once worker is initialized
   * @param  {[type]} execArgv list of string arguments passed to the worker process
   */
  async onWorkerStart(cid, caps, specs, arguments_, execArgv) {},
  /**
   * Gets executed just after a worker process has exited.
   * @param  {String} cid      capability id (e.g 0-0)
   * @param  {Number} exitCode 0 - success, 1 - fail
   * @param  {[type]} specs    specs to be run in the worker process
   * @param  {Number} retries  number of retries used
   */
  async onWorkerEnd(cid, exitCode, specs, retries) {
    const path = require("node:path");
    const promisifiedExec = promisify(exec);
    const initialWorkdir = process.env.INIT_CWD;
    const logDir = path.join(initialWorkdir, "test", "log");

    if (process.platform == "win32") {
      await promisifiedExec(
        `xcopy /s /i /y ${path.join(
          initialWorkdir,
          "test",
          "vcastTutorial"
        )} ${path.join(logDir, "vcastTutorial")} > NUL 2> NUL`
      );
      await promisifiedExec("taskkill -f -im code* > NUL 2> NUL");
    } else {
      await promisifiedExec(
        `cp -r ${path.join(initialWorkdir, "test", "vcastTutorial")} ${logDir}`
      );
      await promisifiedExec("pkill code");
    }
  },

  /**
   * Gets executed just before initialising the webdriver session and test framework. It allows you
   * to manipulate configurations depending on the capability or spec.
   * @param {Object} config wdio configuration object
   * @param {Array.<Object>} capabilities list of capabilities details
   * @param {Array.<String>} specs List of spec file paths that are to be run
   * @param {String} cid worker id (e.g. 0-0)
   */
  // beforeSession: function (config, capabilities, specs, cid) {
  // },
  /**
   * Gets executed before test execution begins. At this point you can access to all global
   * variables like `browser`. It is the perfect place to define custom commands.
   * @param {Array.<Object>} capabilities list of capabilities details
   * @param {Array.<String>} specs        List of spec file paths that are to be run
   * @param {Object}         browser      instance of created browser/device session
   */
  // before: function (capabilities, specs, browser) {

  //   },
  /**
   * Runs before a WebdriverIO command gets executed.
   * @param {String} commandName hook command name
   * @param {Array} args arguments that command would receive
   */
  // beforeCommand: function (commandName, args) {
  // },
  /**
   * Hook that gets executed before the suite starts
   * @param {Object} suite suite details
   */
  // beforeSuite: function (suite) {
  // },
  /**
   * Function to be executed before a test (in Mocha/Jasmine) starts.
   */
  // beforeTest: function (test, context) {
  // },
  /**
   * Hook that gets executed _before_ a hook within the suite starts (e.g. runs before calling
   * beforeEach in Mocha)
   */
  // beforeHook: function (test, context) {
  // },
  /**
   * Hook that gets executed _after_ a hook within the suite starts (e.g. runs after calling
   * afterEach in Mocha)
   */
  // afterHook: function (test, context, { error, result, duration, passed, retries }) {
  // },
  /**
   * Function to be executed after a test (in Mocha/Jasmine only)
   * @param {Object}  test             test object
   * @param {Object}  context          scope object the test was executed with
   * @param {Error}   result.error     error object in case the test fails, otherwise `undefined`
   * @param {Any}     result.result    return object of test function
   * @param {Number}  result.duration  duration of test
   * @param {Boolean} result.passed    true if test has passed, otherwise false
   * @param {Object}  result.retries   informations to spec related retries, e.g. `{ attempts: 0, limit: 0 }`
   */
  afterTest(test, context, { error, result, duration, passed, retries }) {
    // Take a screenshot anytime a test fails and throws an error
    if (error) {
      browser.takeScreenshot();
      const testID = process.env.E2E_TEST_ID;
      const filename = `error in test ${testID} ${test.title}.png`;
      browser.saveScreenshot(filename);
    }
  },

  /**
   * Hook that gets executed after the suite has ended
   * @param {Object} suite suite details
   */
  // afterSuite: function (suite) {
  // },
  /**
   * Runs after a WebdriverIO command gets executed
   * @param {String} commandName hook command name
   * @param {Array} args arguments that command would receive
   * @param {Number} result 0 - command success, 1 - command error
   * @param {Object} error error object if any
   */
  // afterCommand: function (commandName, args, result, error) {
  // },
  /**
   * Gets executed after all tests are done. You still have access to all global variables from
   * the test.
   * @param {Number} result 0 - test pass, 1 - test fail
   * @param {Array.<Object>} capabilities list of capabilities details
   * @param {Array.<String>} specs List of spec file paths that ran
   */
  // after: function (result, capabilities, specs) {
  // },
  /**
   * Gets executed right after terminating the webdriver session.
   * @param {Object} config wdio configuration object
   * @param {Array.<Object>} capabilities list of capabilities details
   * @param {Array.<String>} specs List of spec file paths that ran
   */
  // afterSession: function (config, capabilities, specs) {
  // },
  /**
   * Gets executed after all workers got shut down and the process is about to exit. An error
   * thrown in the onComplete hook will result in the test run failing.
   * @param {Object} exitCode 0 - success, 1 - fail
   * @param {Object} config wdio configuration object
   * @param {Array.<Object>} capabilities list of capabilities details
   * @param {<Object>} results object containing test results
   */
  // onComplete: function(exitCode, config, capabilities, results) {
  // },
  /**
   * Gets executed when a refresh happens.
   * @param {String} oldSessionId session ID of the old session
   * @param {String} newSessionId session ID of the new session
   */
  // onReload: function(oldSessionId, newSessionId) {
  // }
};
