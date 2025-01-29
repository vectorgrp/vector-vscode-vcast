import asyncio
from enum import Enum
from pydantic import BaseModel
import logging
from typing import List, Optional, Tuple

from ..llm_client import LLMClient
from ..test_generation.vcast_context_builder import VcastContextBuilder
from ..test_generation.info_logger import InfoLogger
from ..constants import TEST_FRAMEWORK_REFERENCE_PATH

class TestVerification(BaseModel):
    analysis: str
    is_valid: bool

# TODO: Numeric probability value as derived property using structured logprobs on is_valid
# TODO: Rename is valid to something more descriptive/suitable

class TestVerifier:
    def __init__(self, requirements, environment):
        self.requirements = requirements
        self.environment = environment
        self.context_builder = VcastContextBuilder(self.environment)
        self.llm_client = LLMClient()
        self.info_logger = InfoLogger()

    async def verify_test_case(self, requirement_id: str, test_case) -> TestVerification:
        requirement_text = self.requirements.get(requirement_id)
        if not requirement_text:
            logging.warning(f"Requirement {requirement_id} not found.")
            return TestVerification(
                requirement_id=requirement_id,
                test_name=test_case.test_name,
                is_valid=False,
                analysis="Requirement not found in database"
            )

        # Build code context
        function_name = requirement_id.rsplit('.', 1)[0]
        context = await self.context_builder.build_code_context(function_name)

        with open(TEST_FRAMEWORK_REFERENCE_PATH, "r") as f:
            test_framework_reference = f.read()

        messages = [
            {
                "role": "system",
                "content": "You are an AI assistant that verifies if test cases properly test their associated requirements."
            },
            {
                "role": "user",
                "content": f"""
Please analyze if the following test case properly tests the given requirement.

Test framework reference:
{test_framework_reference}

Relevant Code:
{context}

Requirement ID: {requirement_id}
Requirement Text: {requirement_text}

Test Case:
{test_case.model_dump_json()}

Please analyze:
- Does the test case properly test the requirement?
- Are all aspects of the requirement covered?
- Are the test inputs appropriate for testing the requirement?
- Are the expected outputs correctly validating the requirement?

Provide your analysis in JSON format:
{{
    "analysis": "Your detailed analysis here",
    "is_valid": true | false
}}
"""
            }
        ]

        try:
            result = await self.llm_client.call_model(
                messages,
                TestVerification
            )
            return result
        except Exception as e:
            logging.exception("Failed to verify test case")
            return TestVerification(
                requirement_id=requirement_id,
                test_name=test_case.test_name,
                is_valid=False,
                analysis=f"Verification failed due to error: {str(e)}"
            )

    async def verify_test_cases(self, verification_tasks: List[Tuple[str, object]]) -> List[TestVerification]:
        """
        Verify multiple test cases in parallel
        
        Args:
            verification_tasks: List of tuples containing (requirement_id, test_case)
        
        Returns:
            List of TestVerification results
        """
        tasks = [
            self.verify_test_case(req_id, test_case)
            for req_id, test_case in verification_tasks
        ]
        results = await asyncio.gather(*tasks)
        return results
