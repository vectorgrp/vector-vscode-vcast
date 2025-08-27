from design_decomposition.shared_models import DesignDecompositionResult
from design_decomposition.strategy.decomposition_strategy import DecompositionStrategy


class CharacteristicDecompositionStrategy(DecompositionStrategy):
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

Can you decompose this detailed design into individual flows/paths/requirements through the code, such that each flow/requirements can be tested separately by a single unit test?
If the code (or a requirement) contains a branch (e.g., an if) along with an else case, then these should be considered different flows, as they cannot be considered concurrently.
If there are two branches at the same scope, and where they are not dependent, please provide flow/requirements that allow for these branches to be tested separately and in isolation. Only take two requirements as "true" if they are really related and it is required to exercise the code (e.g., the two conditions are data dependent).

Please try to generate requirements following these characteristics:
— Necessary. The requirement defines an essential capability, characteristic, constraint and/or quality factor. If it is not included in the set of requirements, a deficiency in capability or characteristic will exist, which cannot be fulfilled by implementing other requirements. The requirement is currently applicable and has not been made obsolete by the passage of time. Requirements with planned expiration dates or applicability dates are clearly identified.
— Appropriate. The specific intent and amount of detail of the requirement is appropriate to the level of the entity to which it refers (level of abstraction appropriate to the level of entity). This includes avoiding unnecessary constraints on the architecture or design while allowing implementation independence to the extent possible.
— Unambiguous. The requirement is stated in such a way so that it can be interpreted in only one way.  The requirement is stated simply and is easy to understand.
— Complete. The requirement sufficiently describes the necessary capability, characteristic, constraint or quality factor to meet the entity need without needing other information to understand the requirement.
— Singular. The requirement states a single capability, characteristic, constraint or quality factor.
— Feasible. The requirement can be realized within system constraints (e.g., cost, schedule, technical) with acceptable risk.
— Verifiable. The requirement is structured and worded such that its realization can be proven (verified) to the customer’s satisfaction at the level the requirements exists. Verifiability is enhanced when the requirement is measurable.
— Correct. The requirement is an accurate representation of the entity need from which it was transformed.
— Conforming. The individual items conform to an approved standard template and style for writing requirements, when applicable.

Finally, it should be that, when all of your requirements are taken as a whole, they correspond to the full detailed design.
Do not refer to any actual "specifics" of the code (e.g., variable names or things like that).
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
