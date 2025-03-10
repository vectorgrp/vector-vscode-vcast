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
    requirement_id: str
    analysis: str
    tests_requirement: bool

class TestVerifier:
    def __init__(self, requirements_manager, environment, allow_partial=False):
        self.requirements_manager = requirements_manager
        self.environment = environment
        self.allow_partial = allow_partial
        self.context_builder = VcastContextBuilder(self.environment)
        self.llm_client = LLMClient()
        self.info_logger = InfoLogger()

    async def verify_test_case(self, test_case, requirement_id: Optional[str] = None) -> VerificationOutput:
        req_id = requirement_id or (test_case.requirement_id if test_case else None)
        
        if test_case is None:
            return VerificationOutput(
                requirement_id=req_id or "unknown",
                tests_requirement=False,
                analysis="No test case provided"
            )

        if not req_id:
            return VerificationOutput(
                requirement_id="unknown",
                tests_requirement=False,
                analysis="No requirement ID provided or found in test case"
            )

        requirement_text = self.requirements_manager.get_description(req_id)
        if not requirement_text:
            logging.warning(f"Requirement {req_id} not found.")
            return VerificationOutput(
                requirement_id=req_id,
                tests_requirement=False,
                analysis="Requirement not found in database"
            )

        function_name = self.requirements_manager.get_function(req_id)
        if not function_name:
            logging.warning(f"Function not found for requirement {req_id}.")
            return VerificationOutput(
                requirement_id=req_id,
                tests_requirement=False,
                analysis="Function not found for requirement"
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
{"- Are the expected outputs correctly validating the requirement?" if not self.allow_partial else ""}

Provide your analysis in JSON format:
{{
    "analysis": "Your detailed analysis here",
    "tests_requirement": true | false
}}

Note:
- You can assume that the test case has valid syntax and is correctly formatted. The test framework reference is a guideline but not 100% comprehensive.
- This is especially true for stubbing related matters
- Therefore: Focus on the test case's ability to test the requirement, not on the test case's syntax or formatting.
{"- If a test case is marked as partial, do not mind that. Focus on the parts that are present (the input values). Mark something as wrong only if it is explicitly wrong." if self.allow_partial else ""}
"""
            }
        ]

        try:
            result = await self.llm_client.call_model(
                messages,
                TestVerificationResult,
                max_tokens=10000,
            )
            return VerificationOutput(
                requirement_id=req_id,
                analysis=result.analysis,
                tests_requirement=result.tests_requirement == VerificationResult.YES
            )
        except Exception as e:
            logging.exception("Failed to verify test case")
            return VerificationOutput(
                requirement_id=req_id,
                analysis=f"Verification failed due to error: {str(e)}",
                tests_requirement=False
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
