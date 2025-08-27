from design_decomposition.shared_models import DesignDecompositionResult
from design_decomposition.strategy.decomposition_strategy import DecompositionStrategy


class SimpleDecompositionStrategy(DecompositionStrategy):
    def decompose(self, func_def, n=1, return_messages=False):
        messages = [
            {
                'role': 'system',
                'content': 'You are a world-class software engineer that does requirements engineering for a living.',
            },
            {
                'role': 'user',
                'content': f"""
    Here is some code:
    {func_def.code_with_design}

    and the "detailed design" of the code is between internal and endinternal.

    Derive all functional requirements.
    """,
            },
        ]

        completion = self.client.beta.chat.completions.parse(
            model='gpt-4o',
            messages=messages,
            response_format=DesignDecompositionResult,
            temperature=0.0 if n == 1 else 0.5,
            seed=42,
            n=n,
            max_tokens=5000,
        )

        decomposition_results = [
            choice.message.parsed.without_requirement_indices
            for choice in completion.choices
        ]

        if return_messages:
            return decomposition_results, messages
        return decomposition_results
