import os
import subprocess
from vector.lib.core import VC_Report_Client
from vector.lib.core import VC_Status


current_dir = os.getcwd()
parent_dir = os.path.dirname(current_dir)
lowest_dirname = os.path.basename(current_dir)
env_name = f"{lowest_dirname}.env"
env_path = os.path.join(parent_dir, env_name)

csv_path = os.path.join(parent_dir, 'reqs.csv')
html_path = os.path.join(parent_dir, 'reqs.html')
repository_dir = os.path.join(parent_dir, 'requirement_repository')

command = f'code2reqs "{env_path}" --export-csv "{csv_path}" --export-html "{html_path}" --export-repository "{repository_dir}"'
process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

for line in process.stdout:
    print(line, end='')

for line in process.stderr:
    print(line, end='')

process.wait()

path = html_path
title = "Generated Requirements"
report_client = VC_Report_Client.ReportClient()
if report_client.is_connected():
    report_client.open_report(path, title)

VC_Status.addStatusMessage("Successfully generated requirements for the environment! Please update the environment to see the changes.")
VC_Status.displayStatusMessageBoxAndExit(0)
