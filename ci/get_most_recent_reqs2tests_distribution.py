import os
import json
import logging
import platform
import re
import tempfile
from pathlib import Path
from datetime import datetime

# In "with-ada" mode (R2T_WITH_ADA set) we fetch the Ada-capable build, which
# bundles libadalang (required for Ada requirement generation) and is published
# only for linux under the "-with-ada" name. The Ada e2e is linux-only, so we
# fetch just that artifact and save it under the stock local filename the
# workflow extracts (autoreq-linux.tar.gz). In the normal mode we fetch the
# stock linux + win builds (remote name == local name).
WITH_ADA = os.getenv("R2T_WITH_ADA", "").lower() in ("1", "true", "yes")
if WITH_ADA:
    REMOTE_FOR_LOCAL = {"autoreq-linux.tar.gz": "autoreq-linux-with-ada.tar.gz"}
else:
    REMOTE_FOR_LOCAL = {
        "autoreq-linux.tar.gz": "autoreq-linux.tar.gz",
        "autoreq-win.tar.gz": "autoreq-win.tar.gz",
    }
# Local filenames the rest of the script (and the workflow) expect.
DISTRIBUTION_NAMES = tuple(REMOTE_FOR_LOCAL.keys())

# Distribution folders are named "<timestamp>-<sha>-<run id>". Match the
# timestamp prefix rather than splitting on "-": what follows the timestamp
# varies, and current folders carry a trailing run id.
TIMESTAMP_PREFIX = re.compile(r"^/?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})")


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
    # Save under the local filename the existence check below looks for. In
    # with-ada mode that is the stock "autoreq-linux.tar.gz" even though the
    # override URL points at a "-with-ada" tarball; without this the override
    # would download to the wrong name and be ignored (falling through to
    # Artifactory).
    download_file(url, "autoreq-linux.tar.gz")
if os.getenv("R2T_RELEASE_URL_WIN"):
    logging.info(
        f"Using R2T_RELEASE_URL_WIN: {os.getenv('R2T_RELEASE_URL_WIN')} for Windows"
    )
    url = os.getenv("R2T_RELEASE_URL_WIN").rstrip("/")
    download_file(url)

if all(os.path.exists(f) for f in DISTRIBUTION_NAMES):
    exit(0)


BASE_URL = "https://artifactory.vi.vector.int/artifactory"
# Reqs2X distributions are published from main. Demo releases are published
# separately and are not fetched here; pass R2T_RELEASE_URL_LIN/WIN to test a
# specific build.
BRANCH = os.getenv("R2T_RELEASE_BRANCH", "main")
logging.info(f"Using R2T_RELEASE_BRANCH: {BRANCH}")
PATH = f"rds-build-packages-generic-dev/code2reqs2tests/distributions/{BRANCH}"
API_STORAGE_URL = f"{BASE_URL}/api/storage/{PATH}"

with tempfile.TemporaryDirectory() as tmpdirname:
    tmp = Path(tmpdirname, "tmp.json")
    download_file(API_STORAGE_URL, str(tmp))
    with open(tmp) as f:
        data = json.load(f)

    def parse_date(uri):
        match = TIMESTAMP_PREFIX.match(uri)
        if not match:
            return None
        try:
            return datetime.fromisoformat(match.group(1))
        except ValueError:
            return None

    children_urls = sorted(
        [c["uri"] for c in data["children"] if parse_date(c["uri"]) is not None],
        key=lambda x: parse_date(x),
        reverse=True,
    )

    for c in children_urls:
        for local_name in DISTRIBUTION_NAMES:
            if os.path.exists(local_name):
                continue
            # The artifact on artifactory may have a different name than the
            # local file we save it as (with-ada mode fetches
            # "autoreq-linux-with-ada.tar.gz" but stores it as
            # "autoreq-linux.tar.gz" so the workflow extraction is unchanged).
            remote_name = REMOTE_FOR_LOCAL[local_name]
            url = f"{BASE_URL}/{PATH}{c}/{remote_name}"
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
                download_file(url, local_name)

        if all(os.path.exists(f) for f in DISTRIBUTION_NAMES):
            break

if not all(os.path.exists(f) for f in DISTRIBUTION_NAMES):
    logging.error("Failed to download one or more files.")
    exit(1)
