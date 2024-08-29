import os
import shutil
import subprocess
import sys

VECTORCAST_DIR = os.environ["VECTORCAST_DIR"]

from vector.lib.core.system import cd


testScriptName = "manager-test.tst"


def buildMultipleEnvironments(whereToBuild, templateFileLocation, numberOfEnvironments):

    clicastPath = f'{os.path.join (VECTORCAST_DIR, "clicast")}'

    if os.path.isdir(whereToBuild):
        print(
            f"  Current directory already contains a '{whereToBuild}' sub-directory ... please remove"
        )
        sys.exit(1)

    os.mkdir(whereToBuild)

    with open(os.path.join(templateFileLocation, "DEMO1.env"), "r") as file:
        enviroScriptCommands = file.read().splitlines()

    with cd(whereToBuild):
        shutil.copy(os.path.join(templateFileLocation, "CCAST_.CFG"), ".")
        shutil.copy(os.path.join(templateFileLocation, testScriptName), ".")

        for i in range(1, numberOfEnvironments + 1):
            # since we control the format of the DEMO!.env file we can
            # just asssume that the ENVIRO.NAME line is index 1
            enviroName = f"DEMO{i}"
            with open(f"DEMO.env", "w") as file:
                listToWrite = [
                    enviroScriptCommands[0],
                    f"ENVIRO.NAME:{enviroName}",
                ]
                listToWrite.extend(enviroScriptCommands[2:])
                file.write("\n".join(listToWrite))

            print(f"Building environment {enviroName}, and loading a test script")
            try:
                commandToRun = f"{clicastPath} -lc environment build DEMO.env"
                stdout = subprocess.check_output(commandToRun)
                print(stdout.decode("utf-8"))

                commandToRun = (
                    f"{clicastPath} -e{enviroName} test script run {testScriptName}"
                )
                stdout = subprocess.check_output(commandToRun)
                print(stdout.decode("utf-8"))

            except subprocess.CalledProcessError as error:
                print(error.output.decode("utf-8"))
                break
