/* eslint-disable @typescript-eslint/no-var-requires */
import { exec } from "child_process";
import { promisify } from "node:util";
import { rm, mkdir, copyFile } from "fs/promises";

module.exports = async () => {
  const path = require("path");

  const promisifiedExec = promisify(exec);

  const tstFilename = "firstTest.tst";
  process.env["PACKAGE_PATH"] = process.env["INIT_CWD"];
  process.env["TST_FILENAME"] = tstFilename;
  process.env["VECTORCAST_DIR"] = "";

  let checkVPython: string;
  if (process.platform == "win32") checkVPython = "where vpython";
  else checkVPython = "which vpython";

  {
    try {
      const { stdout, stderr } = await promisifiedExec(checkVPython);
      if (stderr) {
        throw `Error when running "${checkVPython}", make sure vpython is on PATH`;
      } else {
        console.log(`vpython found in ${stdout}`);
      }
    } catch (e) {
      throw `Error when running "${checkVPython}", make sure vpython is on PATH`;
    }
  }

  let checkClicast: string = "";
  if (process.platform == "win32") checkClicast = "where clicast";
  else checkClicast = "which clicast";

  let clicastExecutablePath: string = "";
  {
    try {
      const { stdout, stderr } = await promisifiedExec(checkClicast);
      if (stderr) {
        throw `Error when running ${checkClicast}, make sure clicast is on PATH`;
      } else {
        clicastExecutablePath = stdout;
        console.log(`clicast found in ${clicastExecutablePath}`);
      }
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
  {
    const { stdout, stderr } = await promisifiedExec(clicastTemplateCommand);
    if (stderr) {
      console.log(stderr);
      throw `Error when running ${clicastTemplateCommand}`;
    }
    console.log(stdout);
  }

  const tstFilePath = path.join(vcastEnvPath, tstFilename);
  const createTstFile = `echo -- Environment: TEST > ${tstFilePath}`;
  {
    const stderr = await promisifiedExec(createTstFile)[1];
    if (stderr) {
      console.log(stderr);
      throw `Error when running ${createTstFile}`;
    }
  }

  const tstEnvFilePath = path.join(vcastEnvPath, "TEST.env");
  const runEnvironmentScript = `cd ${vcastEnvPath} && ${clicastExecutablePath.trimEnd()} -lc environment script run ${tstEnvFilePath}`;
  {
    const { stdout, stderr } = await promisifiedExec(runEnvironmentScript);
    if (stderr) {
      console.log(stderr);
      throw `Error when running ${runEnvironmentScript}`;
    }
    console.log(stdout);
  }
};
