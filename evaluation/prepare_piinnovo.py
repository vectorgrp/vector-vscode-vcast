import os
import subprocess
import random
import glob
from pathlib import Path
from tqdm import tqdm

from autoreq.test_generation.environment import Environment
from autoreq.code2reqs import main

env_files = sorted(glob.glob("/home/thiscakeisalie/programming/reqs-to-tests/data/pi--innovo-large-scale/vcast/Pi_Innovo/build/*/*.env"))

def is_usable_env(env_path):
    env = Environment(env_path)
    try:
        env.build()
        result = len(env.units) == 1 and env.testable_functions
    except:
        result = False
    finally:
        env.cleanup()

    return result

usable_envs = [env for env in tqdm(env_files) if is_usable_env(env)]

def get_atg_coverage(env_path):
    env = Environment(env_path)
    try:
        env.build()
        coverage = env.atg_coverage
    except:
        coverage = None
    finally:
        env.cleanup()

    return coverage

coverage_data = {}
for env_file in tqdm(usable_envs):
    coverage = get_atg_coverage(env_file)
    coverage_data[env_file] = coverage

len(coverage_data)

with open("evaluation/piinnovo/usable_envs.txt", "w") as f:
    f.write("\n".join(usable_envs))

with open("evaluation/piinnovo/big_usable_envs.txt", "w") as f:
    import numpy as np
    cutoff = np.quantile([v['branches']['total'] for v in coverage_data.values() if v], 0.9)
    big_envs = [env for env, coverage in coverage_data.items() if coverage and coverage['branches']['total'] > cutoff]
    f.write("\n".join(big_envs))

with open("evaluation/piinnovo/coverage_data.json", "w") as f:
    import json
    json.dump(coverage_data, f)
