import type { Options, Reporters } from "@wdio/types";
// only using global-agent and GlobalDispatcher
// if running on vistr server
import { bootstrap } from "global-agent";
import path from "node:path";
import { URL } from "node:url";
import {
  getGlobalDispatcher,
  setGlobalDispatcher,
  Dispatcher,
  ProxyAgent,
} from "undici";
import {ProxyTypes, ProxyObject} from "@wdio/types/build/Capabilities"
import { exec, execSync } from "child_process";
import { mkdir, rm, writeFile } from "fs/promises";
import { promisify } from "node:util";

const noProxyRules = (process.env["no_proxy"] ?? "")
    .split(",")
    .map((rule) => rule.trim());
if (
  process.env["RUNNING_ON_SERVER"] === "True" ||
  process.env["GITHUB_ACTIONS"] === "true"
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
              rule.startsWith(process.env["INIT_CWD"])
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

import capabilitiesJson from "./capabilityConfig.json";

const proxyType: ProxyTypes = 'manual'
const proxyObject: ProxyObject = {
  proxyType: proxyType,
  ftpProxy: process.env['http_proxy'],
  httpProxy: process.env['http_proxy'],
  noProxy: noProxyRules
}

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
    // see https://github.com/TypeStrong/ts-node#cli-and-programmatic-options
    // for all available options
    tsNodeOpts: {
      transpileOnly: true,
      project: "test/tsconfig.json",
    },
    // tsconfig-paths is only used if "tsConfigPathsOpts" are provided, if you
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
  specs: [
    "./**/**/vcast_testgen_bugs.test.ts",
    "./**/**/vcast_testgen_bugs_2.test.ts",
    // "./**/**/vcast_testgen_env.test.ts",
    // "./**/**/vcast_testgen_unit.test.ts",
    // "./**/**/vcast_testgen_func.test.ts",
    // "./**/**/vcast_coded_tests.test.ts",
    "./**/**/vcast.build_env.test.ts",
    "./**/**/vcast.create_script_1.test.ts",
    "./**/**/vcast.create_script_2_and_run.test.ts",
    "./**/**/vcast.create_second_test_1.test.ts",
    "./**/**/vcast.create_second_test_2_and_run.test.ts",
    "./**/**/vcast.third_test.test.ts",
    "./**/**/vcast.rest.test.ts",
    "./**/**/vcast.rest_2.test.ts",
    "./**/**/vcast.rest_3.test.ts",
  ],
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
      // maxInstances can get overwritten per capability. So if you have an in-house Selenium
      // grid with only 5 firefox instances available you can make sure that not more than
      // 5 instances get started at a time.
      maxInstances: capabilitiesJson["maxInstances"],
      browserName: capabilitiesJson["browserName"],
      proxy: proxyObject,
      browserVersion: capabilitiesJson["browserVersion"],
      acceptInsecureCerts: capabilitiesJson["acceptInsecureCerts"],
      "wdio:vscodeOptions": {
        extensionPath: path.join(__dirname, "extension"),
        workspacePath: path.join(__dirname, "vcastTutorial"),
        vscodeArgs: {
          disableExtensions: true,
          "local-history.enabled":
            capabilitiesJson["wdio:vscodeOptions"]["vscodeArgs"][
              "local-history.enabled"
            ],
        },
        verboseLogging:
          capabilitiesJson["wdio:vscodeOptions"]["verboseLogging"],
        userSettings: {
          "editor.fontSize":
            capabilitiesJson["wdio:vscodeOptions"]["userSettings"][
              "editor.fontSize"
            ],
          "terminal.integrated.fontSize":
            capabilitiesJson["wdio:vscodeOptions"]["userSettings"][
              "terminal.integrated.fontSize"
            ],
          "window.zoomLevel":
            capabilitiesJson["wdio:vscodeOptions"]["userSettings"][
              "window.zoomLevel"
            ],
        },
        vscodeProxyOptions: {
          enable:
            capabilitiesJson["wdio:vscodeOptions"]["vscodeProxyOptions"][
              "enable"
            ],
          port: capabilitiesJson["wdio:vscodeOptions"]["vscodeProxyOptions"][
            "port"
          ],
          connectionTimeout:
            capabilitiesJson["wdio:vscodeOptions"]["vscodeProxyOptions"][
              "connectionTimeout"
            ],
          commandTimeout:
            capabilitiesJson["wdio:vscodeOptions"]["vscodeProxyOptions"][
              "commandTimeout"
            ],
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
  bail: 0,
  //
  // Set a base URL in order to shorten url command calls. If your `url` parameter starts
  // with `/`, the base url gets prepended, not including the path portion of your baseUrl.
  // If your `url` parameter starts without a scheme or `/` (like `some/path`), the base url
  // gets prepended directly.
  baseUrl: "http://localhost",
  //
  // Default timeout for all waitFor* commands.
  waitforTimeout: 30000,
  //
  // Default timeout in milliseconds for request
  // if browser driver or grid doesn"t send response
  connectionRetryTimeout: 22000,
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
    ['junit', {
      outputDir: 'test_results',
      outputFileFormat: function(options) { // optional
        return `results-${options.cid}.xml`
      }
    }]
  ],

  //
  // Options to be passed to Mocha.
  // See the full list at http://mochajs.org/
  mochaOpts: {
    ui: "bdd",
    timeout: 900000,
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
  onPrepare: async function (config, capabilities) {
    const initialWorkdir = process.env["INIT_CWD"];
    const vcastTutorialPath = path.join(
      initialWorkdir,
      "test",
      "vcastTutorial"
    );
    await rm(vcastTutorialPath, { recursive: true, force: true });

    const logPath = path.join(initialWorkdir, "test", "log");
    await rm(logPath, { recursive: true, force: true });
    await mkdir(logPath, { recursive: true });

    await mkdir(path.join(initialWorkdir, "test", "vcastTutorial"));
    const extensionPath = path.join(initialWorkdir, "test", "extension");
    await rm(extensionPath, { recursive: true, force: true });

    const testResultsPath = path.join(initialWorkdir, "test_results");
    await rm(testResultsPath, { recursive: true, force: true });

    const promisifiedExec = promisify(exec);

    process.env["WORKSPACE_FOLDER"] = "vcastTutorial";

    let checkVPython: string;
    if (process.platform == "win32") checkVPython = "where vpython";
    else checkVPython = "which vpython";

    {
      const { stdout, stderr } = await promisifiedExec(checkVPython);
      if (stderr) {
        console.log(stderr);
        throw `Error when running ${checkVPython}`;
      } else {
        console.log(`vpython found in ${stdout}`);
      }
    }

    let checkClicast: string;
    if (process.platform == "win32") checkClicast = "where clicast";
    else checkClicast = "which clicast";

    let clicastExecutablePath: string;
    {
      const { stdout, stderr } = await promisifiedExec(checkClicast);
      if (stderr) {
        console.log(stderr);
        throw `Error when running ${checkClicast}`;
      } else {
        clicastExecutablePath = stdout;
        console.log(`clicast found in ${clicastExecutablePath}`);
      }
    }
    process.env["CLICAST_PATH"] = clicastExecutablePath;

    const vectorcastDir = path.dirname(clicastExecutablePath);
    process.env["VC_DIR"] = vectorcastDir;

    let clearScreenshots: string;
    if (process.platform == "win32") clearScreenshots = "del /s /q *.png";
    else clearScreenshots = "rm -rf *.png";
    await promisifiedExec(clearScreenshots);

    const testInputVcastTutorial = path.join(
      initialWorkdir,
      "test",
      "test_input",
      "vcastTutorial"
    );
    const testInputEnvPath = path.join(testInputVcastTutorial, "cpp");
    await mkdir(testInputEnvPath, { recursive: true });

    const vscodeSettingsPath = path.join(testInputVcastTutorial, ".vscode");
    await mkdir(vscodeSettingsPath, { recursive: true });
    const launchJsonPath = path.join(vscodeSettingsPath, "launch.json");

    let createLaunchJson: string;
    if (process.platform == "win32")
      createLaunchJson = `copy /b NUL ${launchJsonPath}`;
    else createLaunchJson = `touch ${launchJsonPath}`;
    await promisifiedExec(createLaunchJson);

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

    const createCFG = `cd ${testInputVcastTutorial} && clicast -lc template GNU_CPP_X`;
    await promisifiedExec(createCFG);

    const reqTutorialPath = path.join(
      vectorcastDir,
      "examples",
      "RequirementsGW",
      "CSV_Requirements_For_Tutorial.csv"
    );
    const commandPrefix = `cd ${testInputVcastTutorial} && ${clicastExecutablePath.trimEnd()} -lc`;
    const rgwPrepCommands = [
      `${commandPrefix} option VCAST_REPOSITORY ${path.join(
        initialWorkdir,
        "test",
        "vcastTutorial"
      )}`,
      `${commandPrefix} RGw INitialize`,
      `${commandPrefix} Rgw Set Gateway CSV`,
      `${commandPrefix} RGw Configure Set CSV csv_path ${reqTutorialPath}`,
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
      const { stdout, stderr } = await promisifiedExec(rgwPrepCommand);
      if (stderr) {
        console.log(stderr);
        throw `Error when running ${rgwPrepCommand}`;
      }
      console.log(stdout);
    }

    const pathToTutorial = path.join(vectorcastDir, "tutorial", "cpp");
    await mkdir(pathToTutorial, { recursive: true });
    const cppFilesToCopy = path.join(pathToTutorial, "*.cpp");
    const headerFilesToCopy = path.join(pathToTutorial, "*.h");

    const examplesDir = path.join(initialWorkdir, "test", "examples");
    const examplesToCopy = path.join(examplesDir, "*.cpp");

    // copying didn't work with cp from fs
    if (process.platform == "win32") {
      await promisifiedExec(
        `xcopy /s /i /y ${examplesToCopy} ${testInputEnvPath} > NUL 2> NUL`
      );
      await promisifiedExec(
        `xcopy /s /i /y ${cppFilesToCopy} ${testInputEnvPath} > NUL 2> NUL`
      );
      await promisifiedExec(
        `xcopy /s /i /y ${headerFilesToCopy} ${testInputEnvPath} > NUL 2> NUL`
      );
      await promisifiedExec(
        `xcopy /s /i /y ${testInputVcastTutorial} ${path.join(
          initialWorkdir,
          "test",
          "vcastTutorial"
        )}`
      );
    } else {
      await promisifiedExec(`cp ${examplesToCopy} ${testInputEnvPath}`);
      await promisifiedExec(`cp ${cppFilesToCopy} ${testInputEnvPath}`);
      await promisifiedExec(`cp ${headerFilesToCopy} ${testInputEnvPath}`);
      await promisifiedExec(
        `cp -r ${testInputVcastTutorial} ${path.join(initialWorkdir, "test")}`
      );
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
        await promisifiedExec(
          `xcopy /s /i /y ${folderPath} ${path.join(
            extensionUnderTest,
            folderName
          )} > NUL 2> NUL`
        );
        await promisifiedExec(
          `copy /y ${path.join(repoRoot, "package.json")} ${extensionUnderTest}`
        );
      });
    } else {
      foldersToCopy.forEach(async (folderName) => {
        const folderPath = path.join(repoRoot, folderName);
        await promisifiedExec(`cp -r ${folderPath} ${extensionUnderTest}`);
      });
      await promisifiedExec(
        `cp ${path.join(repoRoot, "package.json")} ${extensionUnderTest}`
      );
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
  onWorkerStart: async function (cid, caps, specs, args, execArgv) {

  },
  /**
   * Gets executed just after a worker process has exited.
   * @param  {String} cid      capability id (e.g 0-0)
   * @param  {Number} exitCode 0 - success, 1 - fail
   * @param  {[type]} specs    specs to be run in the worker process
   * @param  {Number} retries  number of retries used
   */
  onWorkerEnd: async function (cid, exitCode, specs, retries) {
    const path = require("path");
    const promisifiedExec = promisify(exec);
    const initialWorkdir = process.env["INIT_CWD"];
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
  afterTest: function (
    test,
    context,
    { error, result, duration, passed, retries }
  ) {
    // take a screenshot anytime a test fails and throws an error
    if (error) {
      browser.takeScreenshot();
      const testID = process.env["E2E_TEST_ID"];
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
