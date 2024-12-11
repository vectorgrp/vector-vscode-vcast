import os
import subprocess
from vector.lib.core import VC_Status


current_dir = os.getcwd()
parent_dir = os.path.dirname(current_dir)
lowest_dirname = os.path.basename(current_dir)
env_name = f"{lowest_dirname}.env"
env_path = os.path.join(parent_dir, env_name)

csv_path = os.path.join(parent_dir, 'reqs.csv')
tst_path = os.path.join(parent_dir, 'reqs2tests.tst')

command = f'reqs2tests "{env_path}" "{csv_path}" --export-tst "{tst_path}" --retries 1'
process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

for line in process.stdout:
    print(line, end='')

for line in process.stderr:
    print(line, end='')

process.wait()

VC_Status.addStatusMessage("Successfully generated tests for the requirements! You can find them under reqs2tests.tst. Add them by importing the script.")
VC_Status.displayStatusMessageBoxAndExit(0)