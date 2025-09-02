from collections import defaultdict
from autoreq.codebase import Codebase
import re
import glob
import csv
import os

codebase = Codebase(["data/pi--innovo-large-scale/src"])

functions = codebase.get_all_functions()

requirements = []
with open(
    "data/pi--innovo-large-scale/vcast/rgw/low_level_requirements.csv", "r"
) as csvfile:
    reader = csv.DictReader(csvfile)
    requirements = list(reader)
print(f"Loaded {len(requirements)} requirements")


def get_unit_for_env(env_file_path):
    with open(env_file_path, "r") as f:
        env_file = f.read()

    match = re.search(r"ENVIRO\.STUB_BY_FUNCTION:\s*(.+)", env_file)

    if match:
        return match.group(1)


unit_to_env = {}
for env_file in glob.glob(
    "data/pi--innovo-large-scale/vcast/**/build/*/*.env", recursive=True
):
    unit_name = get_unit_for_env(env_file)
    if unit_name:
        unit_to_env[unit_name] = env_file


def get_env_for_func(func_def):
    unit_name = os.path.basename(func_def["file"]).split(".")[0]

    if unit_name in unit_to_env:
        return unit_to_env[unit_name]


# req files for each env

env_funcs = defaultdict(list)

for func in functions:
    env_file = get_env_for_func(func)
    if env_file:
        env_funcs[env_file].append(func)


def get_reqs_for_func(func_def):
    func_name = func_def["name"]
    code = func_def["definition"]
    module = (
        os.path.basename(func_def["file"]).replace(".cpp", "").replace(".c", "").title()
    )

    raw_reqs = []
    for req in requirements:
        if req["Requirement"] in code:
            raw_reqs.append(req)

    reqs = []
    for i, raw_req in enumerate(raw_reqs):
        req_id = func_name + "." + str(i + 1)
        reqs.append(
            {
                "Key": req_id,
                "ID": req_id,
                "Module": module,
                "Title": raw_req["Text"],
                "Description": raw_req["Text"],
                "Function": func_name,
            }
        )

    return reqs


non_empty_envs = []
for env_file, funcs in env_funcs.items():
    env_folder = os.path.dirname(env_file)
    env_name = os.path.basename(env_folder)

    env_reqs = []
    for func in funcs:
        env_reqs.extend(get_reqs_for_func(func))

    if env_reqs:
        with open(f"{env_folder}/real_reqs.csv", "w") as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=env_reqs[0].keys())
            writer.writeheader()

            for req in env_reqs:
                writer.writerow(req)

        non_empty_envs.append(env_name)


print(non_empty_envs)
