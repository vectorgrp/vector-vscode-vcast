from autoreq.code2reqs import main as code2reqs_main
from pydantic import BaseModel
import asyncio
from autoreq.llm_client import LLMClient


class CorrespondingFunction(BaseModel):
    reasoning: str
    corresponding_function: str


class Reqs2CodeMapper:
    def __init__(self):
        self.current_llm_client = LLMClient()
        self.current_env_synthetic_requirements_mapping = {}

    async def _generate_requirements_for_env(self, input_env_path):
        try:
            _, current_env_generated_requirements = await code2reqs_main(
                env_path=input_env_path,
            )
            self.current_env_synthetic_requirements_mapping[input_env_path] = {
                requirement_info["Description"]: requirement_info["Function"]
                for requirement_info in current_env_generated_requirements
            }
        except Exception as e:
            print(f"Error generating requirements for {input_env_path}: {e}")
            self.current_env_synthetic_requirements_mapping[input_env_path] = {}

        return self.current_env_synthetic_requirements_mapping

    async def _process_requirement(self, req, input_env_path):
        system_prompt = """You are a helpful assistant and an expert in requirements engineering and semantic similarity"""

        task_prompt = f"""Given a low-level atomic requirement {req}, you need to determine which function is it most likely to be coming from.  You will be given a mapping between low-level requirements and function names.
        Here is the mapping:
        {self.current_env_synthetic_requirements_mapping[input_env_path]} 
        This task is critical, make sure to give the best possible answer.
        Format your output according to the following pydantic model
        class CorrespondingFunction(BaseModel):
            reasoning: str
            corresponding_function: str
        """

        # cropping input to approx. 14k tokens
        # rough estimate, as Patrick had some issues with tiktoken and pyinstaller

        estimated_num_tokens = len(task_prompt) // 4
        if estimated_num_tokens > 14000:
            final_instruction_text = """ This task is critical, make sure to give the best possible answer.
        Format your output according to the following pydantic model
        class CorrespondingFunction(BaseModel):
            reasoning: str
            corresponding_function: str
        """
            task_prompt = task_prompt[: 14000 * 4] + final_instruction_text

        corresponding_function = ""
        try:
            message: CorrespondingFunction = await self.current_llm_client.call_model(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": task_prompt},
                ],
                schema=CorrespondingFunction,
                temperature=0,
                max_completion_tokens=5000,
            )
            corresponding_function = message.corresponding_function
        except Exception as e:
            print(f"Error processing requirement {req}: {e}")
            print("Defaulting to first function in mapping")
            corresponding_function = list(
                self.current_env_synthetic_requirements_mapping[input_env_path].values()
            )[0]

        return (req, corresponding_function)

    async def _process_all_requirements(self, real_requirements, input_env_path):
        async_tasks = []
        for input_requirement in real_requirements:
            async_tasks.append(
                self._process_requirement(input_requirement, input_env_path)
            )

        req2func_mappings = await asyncio.gather(*async_tasks)
        return {req: func for req, func in req2func_mappings}

    async def map_reqs_to_code_for_env(self, input_env_path, real_requirements):
        synthetic_reqs = await self._generate_requirements_for_env(input_env_path)
        if not synthetic_reqs:
            print(f"No synthetic requirements generated for {input_env_path}")
            return {}
        req2func_mappings = await self._process_all_requirements(
            real_requirements, input_env_path
        )
        return req2func_mappings

    async def map_reqs_to_code_for_env_list(self, env_paths_real_reqs_mapping):
        all_mappings = {}
        async_tasks = []
        for env_path, real_reqs in env_paths_real_reqs_mapping.items():
            async_tasks.append(self.map_reqs_to_code_for_env(env_path, real_reqs))

        req2func_mappings = await asyncio.gather(*async_tasks)
        for i, env_path in enumerate(env_paths_real_reqs_mapping.keys()):
            all_mappings[env_path] = req2func_mappings[i]
        return all_mappings
