import os
import json
import logging
import platform
import tempfile
from pathlib import Path
from datetime import datetime

DISTRIBUTION_NAMES = ("autoreq-linux.tar.gz", "autoreq-win.tar.gz")


def download_file(url, filename=None):
    if not filename:
        filename = url.rstrip("/").split("/")[-1]

    if platform.system() == "Windows":
        cmd = f"(New-Object System.Net.WebClient).DownloadFile('{url}', '{filename}')"
        cmd = f'powershell -Command "{cmd}" > $null 2>&1'
    else:
        cmd = f"wget {url} -O {filename}"
        cmd += " > /dev/null 2>&1"
    os.system(cmd)


if os.getenv("R2T_RELEASE_URL_LIN"):
    logging.info(
        f"Using R2T_RELEASE_URL_LIN: {os.getenv('R2T_RELEASE_URL_LIN')} for Linux"
    )
    url = os.getenv("R2T_RELEASE_URL_LIN").rstrip("/")
    download_file(url)
if os.getenv("R2T_RELEASE_URL_WIN"):
    logging.info(
        f"Using R2T_RELEASE_URL_WIN: {os.getenv('R2T_RELEASE_URL_WIN')} for Windows"
    )
    url = os.getenv("R2T_RELEASE_URL_WIN").rstrip("/")
    download_file(url)

if all(os.path.exists(f) for f in DISTRIBUTION_NAMES):
    exit(0)


BASE_URL = "https://artifactory.vi.vector.int/artifactory"
BRANCH = os.getenv("R2T_RELEASE_BRANCH", "demo_release")
logging.info(f"Using R2T_RELEASE_BRANCH: {BRANCH}")
PATH = f"rds-build-packages-generic-dev/code2reqs2tests/distributions/{BRANCH}"
API_STORAGE_URL = f"{BASE_URL}/api/storage/{PATH}"

with tempfile.TemporaryDirectory() as tmpdirname:
    tmp = Path(tmpdirname, "tmp.json")
    download_file(API_STORAGE_URL, str(tmp))
    with open(tmp) as f:
        data = json.load(f)

    children_urls = sorted(
        [c["uri"] for c in data["children"] if c["uri"].rsplit("-", 1)[0][1:]],
        key=lambda x: datetime.fromisoformat(x.rsplit("-", 1)[0][1:]),
        reverse=True,
    )

    for c in children_urls:
        for distribution_name in DISTRIBUTION_NAMES:
            if os.path.exists(distribution_name):
                continue
            url = f"{BASE_URL}/{PATH}{c}/{distribution_name}"
            status_file = Path(tmpdirname, "status.txt")
            if platform.system() == "Windows":
                cmd = (
                    f"$req = [System.Net.WebRequest]::Create('{url}'); $req.Method = 'HEAD'; "
                    f"$res = $req.GetResponse(); $status = $res.StatusCode; $res.Close(); "
                    f"Write-Output $status | Out-File -FilePath '{status_file}' -Encoding UTF8"
                )
                cmd = f'powershell -Command "{cmd}"'
            else:
                cmd = (
                    f'wget --spider -S {url} 2>&1 | grep "HTTP/" '
                    f"| awk '{{print $2}}' > {status_file}"
                )
            os.system(cmd)
            with open(status_file) as f:
                status = f.read().strip()
            if status == "200" or status.strip().endswith("OK"):
                download_file(url)

        if all(os.path.exists(f) for f in DISTRIBUTION_NAMES):
            break

if not all(os.path.exists(f) for f in DISTRIBUTION_NAMES):
    logging.error("Failed to download one or more files.")
    exit(1)
