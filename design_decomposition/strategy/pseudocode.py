from typing import List
from pydantic import BaseModel

from design_decomposition.shared_models import DesignDecompositionResult
from design_decomposition.strategy.decomposition_strategy import DecompositionStrategy


class DesignDecompositionResultWithPseudocode(BaseModel):
    pseudo_code_output: str
    requirements: List[str]

    @property
    def without_code(self):
        return DesignDecompositionResult(requirements=self.requirements)


class PseudocodeDecompositionStrategy(DecompositionStrategy):
    def decompose(self, func_def, n=1, return_messages=False):
        messages = [
            {
                'role': 'system',
                'content': 'You are an AI assistant proficient in requirements engineering.',
            },
            {
                'role': 'user',
                'content': f"""
Derive a complete list of functional requirements for the given function definition.

You are given the following inputs:
                
- code_design:
{func_def.design}

- code:
{func_def.code}

Please execute the following pseudocode algorithm to derive the requirements:
```
def enumerate_paths(code, **kwargs):
    control_flow_graph = build_control_flow_graph(code)

    branch_points = control_flow_graph.get_branch_points(ignore_loop_constructs=True, ignore_preprocessor=False)
    print("Branch points:")
    for branch_point in branch_points:
        print("- " + branch_point)

    paths = control_flow_graph.enumerate_paths_through_branch_points(branch_points)

    return paths

def derive_requirements(code_design, code):
    # Find all paths through the code
    paths = enumerate_paths(code)

    print("Paths:")
    for path in paths:
        print("- " + path)

    # Only consider paths which the design actually mentions
    designed_paths = []

    for path in paths:
        if is_path_designed(path, code_design):
            designed_paths.append(path)
            
    print("Designed paths:")
    for path in designed_paths:
        print("- " + path)
        
    # Derive requirements for each designed path
    requirements = []
    for path in designed_paths:
        derived_requirement = derive_requirement(
            path,
            code_design,
            code,
            max_sentences=2,
            allow_function_variable_mentions=False,
            include_full_path_description=True,
            include_behavior_description=True
        )
        requirements.append(derived_requirement)
        
    return requirements

if __name__ == "__main__":
    derive_requirements(code_design, code)
```

The success of this task is critical. The purpose is to derive unit tests, exactly one per requirement, that will test the behaviour of the code path described in the final requirements.
""",
            },
        ]

        completion = self.client.beta.chat.completions.parse(
            model='gpt-4o',
            messages=messages,
            response_format=DesignDecompositionResultWithPseudocode,
            temperature=0.0 if n == 1 else 0.5,
            seed=42,
            n=n,
            max_tokens=5000,
        )

        decomposition_results = [
            choice.message.parsed.without_code.without_requirement_indices
            for choice in completion.choices
        ]

        if return_messages:
            return decomposition_results, messages
        return decomposition_results
