/* eslint-disable unicorn/filename-case */
/* eslint-disable @typescript-eslint/no-var-requires */

import { rm, mkdir, copyFile } from "node:fs/promises";
import process from "node:process";
import { runCommand } from "./utils";

module.exports = async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path");

  const tstFilename = "firstTest.tst";
  process.env.PACKAGE_PATH = process.env.INIT_CWD;
  process.env.TST_FILENAME = tstFilename;
  process.env.VECTORCAST_DIR = "";

  const checkVpython: string =
    process.platform === "win32" ? "where vpython" : "which vpython";

  try {
    await runCommand(checkVpython);
  } catch {
    throw new Error(
      `Error when running "${checkVpython}", make sure vpython is on PATH`
    );
  }

  let checkClicast = "";
  checkClicast =
    process.platform === "win32" ? "where clicast" : "which clicast";

  const clicastExecutablePath = "";
  try {
    await runCommand(checkClicast);
  } catch {
    throw new Error(
      `Error when running "${checkClicast}", make sure clicast is on PATH`
    );
  }

  const unitTestsPath = path.join(process.env.PACKAGE_PATH, "tests", "unit");
  const vcastEnvPath = path.join(unitTestsPath, "vcast");
  const coverageFolderPath = path.join(process.env.PACKAGE_PATH, "coverage");
  const resourcesFolderPath = path.join(unitTestsPath, "resources");

  await rm(vcastEnvPath, { recursive: true, force: true });
  await rm(coverageFolderPath, { recursive: true, force: true });
  await mkdir(path.join(unitTestsPath, "vcast"));
  await copyFile(
    path.join(resourcesFolderPath, "TEST.env"),
    path.join(vcastEnvPath, "TEST.env")
  );
  await copyFile(
    path.join(resourcesFolderPath, "unit.cpp"),
    path.join(vcastEnvPath, "unit.cpp")
  );

  const clicastTemplateCommand = `cd ${vcastEnvPath} && ${clicastExecutablePath.trimEnd()} -l C template GNU_CPP11_X`;
  await runCommand(clicastTemplateCommand);

  // eslint-disable-next-line unicorn/prevent-abbreviations
  const vectorcastDir = path.dirname(clicastExecutablePath);
  const requestTutorialPath = path.join(
    vectorcastDir,
    "examples",
    "RequirementsGW",
    "CSV_Requirements_For_Tutorial.csv"
  );
  const commandPrefix = `cd ${vcastEnvPath} && ${clicastExecutablePath.trimEnd()} -lc`;
  const rgwPrepCommands = [
    `${commandPrefix} option VCAST_REPOSITORY ${vcastEnvPath}`,
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

  // Basically a for loop, but we need to await runCommand.
  // xo throws an no-await-in-loop error otherwise
  await Promise.all(
    rgwPrepCommands.map(async (rgwPrepCommand) => runCommand(rgwPrepCommand))
  );

  const tstFilePath = path.join(vcastEnvPath, tstFilename);
  const createTstFile = `echo -- Environment: TEST > ${tstFilePath}`;
  await runCommand(createTstFile);

  const tstEnvFilePath = path.join(vcastEnvPath, "TEST.env");
  const runEnvironmentScript = `cd ${vcastEnvPath} && ${clicastExecutablePath.trimEnd()} -lc environment script run ${tstEnvFilePath}`;
  await runCommand(runEnvironmentScript);
};
