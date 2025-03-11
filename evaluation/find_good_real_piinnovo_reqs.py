import os
import asyncio
from pydantic import BaseModel
import tqdm.asyncio
from autoreq.requirement_verification.verification import RequirementsVerifier
from autoreq.requirements_manager import RequirementsManager
from autoreq.test_generation.environment import Environment
from tqdm import tqdm

PI_INNOVO_SRC_PATH = "/home/thiscakeisalie/programming/reqs-to-tests/data/pi--innovo-large-scale/src"

os.environ["PI_INNOVO_SRC_PATH"] = PI_INNOVO_SRC_PATH

with open("evaluation/piinnovo/usable_envs.txt") as f:
    usable_envs = f.read().splitlines()

def has_real_requirements(env_path):
    reqs_path = os.path.join(os.path.dirname(env_path), "real_reqs.csv")

    return os.path.exists(reqs_path)

envs_with_real_reqs = [env for env in usable_envs if has_real_requirements(env)]

async def calculate_req_score(env_path):
    env = Environment(env_path)
    env.build()

    reqs_path = os.path.join(os.path.dirname(env_path), "real_reqs.csv")
    rm = RequirementsManager(reqs_path)
    reqs_by_func = rm.group_by_function(rm.requirement_ids)

    verifier = RequirementsVerifier(env)

    func_names, all_requirement_ids = zip(*reqs_by_func.items())
    requirements = [[rm.get_description(req_id) for req_id in requirement_ids] for requirement_ids in all_requirement_ids]
    all_results = await verifier.evaluate_requirements_batch(func_names, requirements, mode="exhaustiveness")
    score = min(r.score for r in all_results)

    env.cleanup()

    return score

async def calculate_req_scores(env_paths):
    env_scores = {}
    for env in tqdm(env_paths):
        env_scores[env] = await calculate_req_score(env)

    return env_scores

scores = asyncio.run(calculate_req_scores(envs_with_real_reqs))

good_envs = [env for env, score in scores.items() if score >= 0.8]

good_envs_with_real_req_paths = [env_path + ":" + os.path.join(os.path.dirname(env_path), "real_reqs.csv") for env_path in good_envs]

with open("evaluation/piinnovo/real_req_envs.txt", "w") as f:
    f.write("\n".join(good_envs_with_real_req_paths))