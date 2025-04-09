import os
import json
import logging
import tempfile
from datetime import datetime

BASE_URL = "https://artifactory.vi.vector.int/artifactory"
PATH = "rds-build-packages-generic-dev/code2reqs2tests/distributions/demo_release"
API_STORAGE_URL = f"{BASE_URL}/api/storage/{PATH}"

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
        url = f"{BASE_URL}/{PATH}{c}/autoreq-linux.tar.gz"
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
            break

    if not os.path.exists("autoreq-linux.tar.gz"):
        logging.error("Failed to download the file.")
        exit(1)
