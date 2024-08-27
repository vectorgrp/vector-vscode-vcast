/* eslint-disable @typescript-eslint/no-var-requires */
import { rm, mkdir, copyFile } from "fs/promises";
import { runCommand } from "./utils";

module.exports = async () => {
  const path = require("path");

  const tstFilename = "firstTest.tst";
  process.env["PACKAGE_PATH"] = process.env["INIT_CWD"];
  process.env["TST_FILENAME"] = tstFilename;
  process.env["VECTORCAST_DIR"] = "";

  let checkVPython: string;
  if (process.platform == "win32") checkVPython = "where vpython";
  else checkVPython = "which vpython";

  {
    try {
      runCommand(checkVPython);
    } catch (e) {
      throw `Error when running "${checkVPython}", make sure vpython is on PATH`;
    }
  }

  let checkClicast = "";
  if (process.platform == "win32") checkClicast = "where clicast";
  else checkClicast = "which clicast";

  let clicastExecutablePath = "";
  {
    try {
      runCommand(checkClicast);
    } catch (e) {
      throw `Error when running "${checkClicast}", make sure clicast is on PATH`;
    }
  }

  const unitTestsPath = path.join(process.env["PACKAGE_PATH"], "tests", "unit");
  const vcastEnvPath = path.join(unitTestsPath, "vcast");
  const coverageFolderPath = path.join(process.env["PACKAGE_PATH"], "coverage");
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
  runCommand(clicastTemplateCommand);

  const vectorcastDir = path.dirname(clicastExecutablePath);
  const reqTutorialPath = path.join(
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
    runCommand(rgwPrepCommand);
  }

  const tstFilePath = path.join(vcastEnvPath, tstFilename);
  const createTstFile = `echo -- Environment: TEST > ${tstFilePath}`;
  runCommand(createTstFile);

  const tstEnvFilePath = path.join(vcastEnvPath, "TEST.env");
  const runEnvironmentScript = `cd ${vcastEnvPath} && ${clicastExecutablePath.trimEnd()} -lc environment script run ${tstEnvFilePath}`;
  runCommand(runEnvironmentScript);
};
