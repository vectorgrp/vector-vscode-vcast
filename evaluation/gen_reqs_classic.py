import asyncio
import os
import subprocess
import random
import glob
from pathlib import Path
from tqdm import tqdm

from autoreq.test_generation.environment import Environment
from autoreq.code2reqs import main as gen_reqs

random.seed(42)
MAX_N = 100
MAX_COST = 100
MSR4_PRODUCT_VTTONLY_R33_LATEST_REQUIREMENTS_SRC_PATH="/home/thiscakeisalie/programming/data/msr4-product-vtt-only-r33-latest-requirements/src"

os.environ["MSR4_PRODUCT_VTTONLY_R33_LATEST_REQUIREMENTS_SRC_PATH"] = MSR4_PRODUCT_VTTONLY_R33_LATEST_REQUIREMENTS_SRC_PATH

with open("evaluation/classic/usable_envs.txt") as f:
    usable_envs = f.read().splitlines()

async def gen_requirements(env_path, allow_existing=False):
    env_file_folder_path = Path(env_path).parent

    if allow_existing and (env_file_folder_path / "reqs.csv").exists():
        print(f"Requirements already exist for {env_path}")
        return True
    
    reqs_csv_path = env_file_folder_path / "reqs.csv"
    reqs_html_path = env_file_folder_path / "reqs.html"
    
    total_cost = await gen_reqs(env_path, export_csv=reqs_csv_path, export_html=reqs_html_path)

    return total_cost

random_envs = random.sample(usable_envs, min(MAX_N, len(usable_envs)))

async def main():
    total_cost = 0
    bench_envs = []
    for env_file in tqdm(random_envs):
        if total_cost > MAX_COST:
            break
        
        cost = await gen_requirements(env_file, allow_existing=False)
        total_cost += cost
        bench_envs.append(env_file)
        print(f"Total cost: {total_cost}")
        print(len(bench_envs), bench_envs)

        with open("evaluation/classic/bench_envs.txt", "w") as f:
            f.write("\n".join(bench_envs))

asyncio.run(main())