import os
import json
import logging
import tempfile
from datetime import datetime

BASE_URL = "https://artifactory.vi.vector.int/artifactory"
PATH = "rds-build-packages-generic-dev/code2reqs2tests/distributions/demo_release"
API_STORAGE_URL = f"{BASE_URL}/api/storage/{PATH}"
DISTRIBUTION_NAMES = ('autoreq-linux.tar.gz', 'autoreq-win.tar.gz')

with tempfile.TemporaryDirectory() as tmpdirname:
    os.system(f"wget {API_STORAGE_URL} -O {tmpdirname}/tmp.json > /dev/null 2>&1")
    with open(f"{tmpdirname}/tmp.json") as f:
        data = json.load(f)

    children_urls = sorted(
        [c["uri"] for c in data["children"]],
        key=lambda x: datetime.fromisoformat(x.rsplit("-", 1)[0][1:]),
        reverse=True,
    )

    for c in children_urls:
        for distribution_name in DISTRIBUTION_NAMES:
            if os.path.exists(distribution_name):
                continue
            url = f"{BASE_URL}/{PATH}{c}/{distribution_name}"
            status_file = f"{tmpdirname}/status.txt"
            os.system(
                f'wget --spider -S {url} 2>&1 | grep "HTTP/"'
                + " | awk '{print $2}' > "
                + status_file
            )
            with open(status_file) as f:
                status = f.read().strip()
            if int(status) == 200:
                os.system(f"wget {url} > /dev/null 2>&1")

        if all(os.path.exists(f) for f in DISTRIBUTION_NAMES):
            break

    if not all(os.path.exists(f) for f in DISTRIBUTION_NAMES):
        logging.error("Failed to download one or more files.")
        exit(1)
