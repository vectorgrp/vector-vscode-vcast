import asyncio
from enum import Enum
from pydantic import BaseModel
import logging
from typing import List, Optional, Tuple
import math

from ..llm_client import LLMClient
from ..test_generation.vcast_context_builder import VcastContextBuilder
from ..test_generation.info_logger import InfoLogger
from ..constants import TEST_FRAMEWORK_REFERENCE_PATH

class VerificationResult(str, Enum):
    YES = "yes"
    NO = "no"

class TestVerificationResult(BaseModel):
    analysis: str
    tests_requirement: VerificationResult

class VerificationOutput(BaseModel):
    analysis: str
    tests_requirement: bool
    confidence: float

class TestVerifier:
    def __init__(self, requirements_manager, environment):
        self.requirements_manager = requirements_manager
        self.environment = environment
        self.context_builder = VcastContextBuilder(self.environment)
        self.llm_client = LLMClient()
        self.info_logger = InfoLogger()

    async def verify_test_case(self, test_case, requirement_id: Optional[str] = None) -> VerificationOutput:
        if test_case is None:
            return VerificationOutput(
                tests_requirement=False,
                analysis="No test case provided",
                confidence=1.0  # We are certain that None doesn't test requirements
            )

        req_id = requirement_id or test_case.requirement_id
        if not req_id:
            return VerificationOutput(
                tests_requirement=False,
                analysis="No requirement ID provided or found in test case",
                confidence=0.0
            )

        requirement_text = self.requirements_manager.get_description(req_id)
        if not requirement_text:
            logging.warning(f"Requirement {req_id} not found.")
            return VerificationOutput(
                tests_requirement=False,
                analysis="Requirement not found in database",
                confidence=0.0
            )

        function_name = self.requirements_manager.get_function(req_id)
        if not function_name:
            logging.warning(f"Function not found for requirement {req_id}.")
            return VerificationOutput(
                tests_requirement=False,
                analysis="Function not found for requirement",
                confidence=0.0
            )

        # Build code context
        context = await self.context_builder.build_code_context(function_name)

        with open(TEST_FRAMEWORK_REFERENCE_PATH, "r") as f:
            test_framework_reference = f.read()

        test_case_json = test_case.model_dump_json(indent=2)

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

Requirement ID: {req_id}
Requirement Text: {requirement_text}

Test Case:
{test_case_json}

Please analyze:
- Does the test case properly test the requirement?
- Are all aspects of the requirement covered?
- Are the test inputs appropriate for testing the requirement?
- Are the expected outputs correctly validating the requirement?

Provide your analysis in JSON format:
{{
    "analysis": "Your detailed analysis here",
    "tests_requirement": true | false
}}
"""
            }
        ]

        try:
            result, log_probs = await self.llm_client.call_model(
                messages,
                TestVerificationResult,
                return_logprobs=True
            )
            confidence = math.exp(log_probs['tests_requirement'])
            return VerificationOutput(
                analysis=result.analysis,
                tests_requirement=result.tests_requirement == VerificationResult.YES,
                confidence=confidence
            )
        except Exception as e:
            logging.exception("Failed to verify test case")
            return VerificationOutput(
                analysis=f"Verification failed due to error: {str(e)}",
                tests_requirement=False,
                confidence=0.0
            )

    async def verify_test_cases(
        self, 
        test_cases: List[Optional[object]], 
        requirement_ids: Optional[List[str]] = None
    ) -> List[VerificationOutput]:
        """
        Verify multiple test cases in parallel
        
        Args:
            test_cases: List of test cases (can contain None values)
            requirement_ids: Optional list of requirement IDs to use instead of test_case.requirement_id
        
        Returns:
            List of VerificationOutput results
        """
        if requirement_ids:
            tasks = [
                self.verify_test_case(test_case, req_id) 
                for test_case, req_id in zip(test_cases, requirement_ids)
            ]
        else:
            tasks = [self.verify_test_case(test_case) for test_case in test_cases]
            
        return await asyncio.gather(*tasks)
