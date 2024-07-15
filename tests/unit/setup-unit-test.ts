import path from "node:path";
import process from "node:process";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { rm, mkdir, copyFile } from "node:fs/promises";

module.exports = async () => {
  const promisifiedExec = promisify(exec);

  const tstFilename = "firstTest.tst";
  process.env.PACKAGE_PATH = process.env.INIT_CWD;
  process.env.TST_FILENAME = tstFilename;
  process.env.VECTORCAST_DIR = "";

  const checkVpython: string =
    process.platform === "win32" ? "where vpython" : "which vpython";

  try {
    const { stdout, stderr } = await promisifiedExec(checkVpython);
    if (stderr) {
      throw new Error(
        `Error when running "${checkVpython}", make sure vpython is on PATH`
      );
    } else {
      console.log(`vpython found in ${stdout}`);
    }
  } catch {
    throw new Error(
      `Error when running "${checkVpython}", make sure vpython is on PATH`
    );
  }

  const checkClicast =
    process.platform === "win32" ? "where clicast" : "which clicast";

  let clicastExecutablePath = "";
  try {
    const { stdout, stderr } = await promisifiedExec(checkClicast);
    if (stderr) {
      throw new Error(
        `Error when running ${checkClicast}, make sure clicast is on PATH`
      );
    } else {
      clicastExecutablePath = stdout;
      console.log(`clicast found in ${clicastExecutablePath}`);
    }
  } catch {
    throw new Error(
      `Error when running "${checkClicast}", make sure clicast is on PATH`
    );
  }

  const unitTestsPath = path.join(
    process.env.PACKAGE_PATH as string,
    "tests",
    "unit"
  );
  const vcastEnvPath = path.join(unitTestsPath, "vcast");
  const coverageFolderPath = path.join(
    process.env.PACKAGE_PATH as string,
    "coverage"
  );
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
  const { stdout, stderr } = await promisifiedExec(clicastTemplateCommand);
  if (stderr) {
    console.log(stderr);
    throw new Error(`Error when running ${clicastTemplateCommand}`);
  }

  console.log(stdout);

  const vectorcastDirectory = path.dirname(clicastExecutablePath);
  const requestTutorialPath = path.join(
    vectorcastDirectory,
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
  for (const rgwPrepCommand of rgwPrepCommands) {
    // eslint-disable-next-line no-await-in-loop
    const { stdout, stderr } = await promisifiedExec(rgwPrepCommand);
    if (stderr) {
      console.log(stderr);
      throw new Error(`Error when running ${rgwPrepCommand}`);
    }

    console.log(stdout);
  }

  const tstFilePath = path.join(vcastEnvPath, tstFilename);
  const createTstFile = `echo -- Environment: TEST > ${tstFilePath}`;
  {
    const stderr: string = (await promisifiedExec(createTstFile)).stderr;
    if (stderr) {
      console.log(stderr);
      throw new Error(`Error when running ${createTstFile}`);
    }
  }

  const tstEnvFilePath = path.join(vcastEnvPath, "TEST.env");
  const runEnvironmentScript = `cd ${vcastEnvPath} && ${clicastExecutablePath.trimEnd()} -lc environment script run ${tstEnvFilePath}`;
  {
    const { stdout, stderr } = await promisifiedExec(runEnvironmentScript);
    if (stderr) {
      console.log(stderr);
      throw new Error(`Error when running ${runEnvironmentScript}`);
    }

    console.log(stdout);
  }
};
