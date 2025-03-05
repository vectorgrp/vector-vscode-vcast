import json
import os
import argparse
import asyncio
import logging
import csv
import time
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, computed_field
from tqdm import tqdm
import traceback

from .requirements_manager import RequirementsManager
from .test_generation.generation import TestGenerator
from .test_generation.environment import Environment
from .test_verification.verification import TestVerifier
from .summary import SummaryEngine


class EvaluationResult(BaseModel):
    # Basic information
    environment_path: str
    
    # Raw data needed for calculations
    requirements_data: Dict[str, Any]
    info_logger_data: Dict[str, Any]
    verification_summary: str
    atg_coverage: Dict[str, Any]
    coverage: Dict[str, Any]
    token_usage: Dict[str, Dict[str, int]]
    total_cost: float
    
    # Verification data
    verified_tests: int
    unverified_requirements: List[str]
    
    # Optional error information
    generation_error: Optional[str] = None
    
    # Fallback information
    used_atg_identifier_fallback: bool
    used_atg_testable_functions_fallback: bool
    
    # Execution information
    execution_time: float
    timed_out: bool = False
    
    @computed_field
    def total_requirements(self) -> int:
        return len(self.requirements_data)
    
    @computed_field
    def generated_tests(self) -> int:
        return len([req_id for req_id, data in self.info_logger_data.items() 
                    if data['test_generated']])
    
    @computed_field
    def precision(self) -> float:
        return self.verified_tests / self.generated_tests if self.generated_tests > 0 else 0
    
    @computed_field
    def recall(self) -> float:
        return self.verified_tests / self.total_requirements if self.total_requirements > 0 else 0
    
    @computed_field
    def f1_score(self) -> float:
        if (self.precision + self.recall) > 0:
            return 2 * (self.precision * self.recall) / (self.precision + self.recall) 
        return 0
    
    @computed_field
    def failed_generation_reqs(self) -> List[str]:
        return [req_id for req_id, data in self.info_logger_data.items()
                if not data['test_generated']]
    
    @computed_field
    def failed_generation_rate(self) -> float:
        return len(self.failed_generation_reqs) / self.total_requirements if self.total_requirements > 0 else 0
    
    @computed_field
    def test_failure_feedback_reqs(self) -> List[str]:
        return [req_id for req_id, data in self.info_logger_data.items()
                if data['test_run_failure_feedback'] and data['test_generated']]
    
    @computed_field
    def test_failure_feedback_rate(self) -> float:
        return len(self.test_failure_feedback_reqs) / self.total_requirements if self.total_requirements > 0 else 0
    
    @computed_field
    def error_correction_needed_reqs(self) -> List[str]:
        return [req_id for req_id, data in self.info_logger_data.items()
                if data['error_correction_needed']]
    
    @computed_field
    def error_correction_needed_rate(self) -> float:
        return len(self.error_correction_needed_reqs) / self.total_requirements if self.total_requirements > 0 else 0
    
    @computed_field
    def partial_test_reqs(self) -> List[str]:
        return [req_id for req_id, data in self.info_logger_data.items()
                if data['partial_test_generated']]
    
    @computed_field
    def partial_test_rate(self) -> float:
        return len(self.partial_test_reqs) / self.total_requirements if self.total_requirements > 0 else 0
    
    @computed_field
    def individual_generation_reqs(self) -> List[str]:
        return [req_id for req_id, data in self.info_logger_data.items()
                if data['individual_test_generation_needed']]
    
    @computed_field
    def individual_generation_rate(self) -> float:
        return len(self.individual_generation_reqs) / self.total_requirements if self.total_requirements > 0 else 0
    
    @computed_field
    def found_allowed_identifiers_reqs(self) -> List[str]:
        return [req_id for req_id, data in self.info_logger_data.items()
                if data['found_allowed_identifiers']]
    
    @computed_field
    def found_allowed_identifiers_rate(self) -> float:
        return len(self.found_allowed_identifiers_reqs) / self.total_requirements if self.total_requirements > 0 else 0
    
    @computed_field
    def schema_exceeded_size_reqs(self) -> List[str]:
        return [req_id for req_id, data in self.info_logger_data.items()
                if data['schema_exceeded_size']]
    
    @computed_field
    def schema_exceeded_size_rate(self) -> float:
        return len(self.schema_exceeded_size_reqs) / self.total_requirements if self.total_requirements > 0 else 0
    
    @computed_field
    def found_atg_examples_reqs(self) -> List[str]:
        return [req_id for req_id, data in self.info_logger_data.items()
                if data['found_atg_examples']]
    
    @computed_field
    def found_atg_examples_rate(self) -> float:
        return len(self.found_atg_examples_reqs) / self.total_requirements if self.total_requirements > 0 else 0

    @computed_field
    def used_code_context_fallback_reqs(self) -> List[str]:
        return [req_id for req_id, data in self.info_logger_data.items()
                if data['used_code_context_fallback']]
        
    @computed_field
    def used_code_context_fallback_rate(self) -> float:
        return len(self.used_code_context_fallback_reqs) / self.total_requirements if self.total_requirements > 0 else 0
    
    class Config:
        populate_by_name = True


async def evaluate_environment_with_timeout(
    env_path: str,
    rm: RequirementsManager,
    output_dir: Path,
    requirement_ids: List[str] = None,
    extended_reasoning: bool = False,
    allow_partial: bool = False,
    batched: bool = True,
    batch_size: int = 8,
    max_retries: int = 2,
    allow_batch_partial: bool = False,
    timeout_minutes: float = 30.0
) -> EvaluationResult:
    """Wrapper for evaluate_environment that enforces a timeout"""
    start_time = time.perf_counter()
    
    try:
        # Convert minutes to seconds for the timeout
        timeout_seconds = timeout_minutes * 60
        
        # Run the evaluation with a timeout
        result = await asyncio.wait_for(
            evaluate_environment(
                env_path=env_path,
                rm=rm,
                output_dir=output_dir,
                requirement_ids=requirement_ids,
                extended_reasoning=extended_reasoning,
                allow_partial=allow_partial,
                batched=batched,
                batch_size=batch_size,
                max_retries=max_retries,
                allow_batch_partial=allow_batch_partial
            ),
            timeout=timeout_seconds
        )
    except asyncio.TimeoutError:
        # Create a basic result with timeout information
        env = Environment(env_path)
        
        if not requirement_ids:
            requirement_ids = rm.requirement_ids
            
        requirements_data = {req_id: rm.get_requirement(req_id) for req_id in requirement_ids}
        
        # Get ATG coverage data
        try:
            env.build()
            atg_coverage = env.atg_coverage
        except Exception as e:
            atg_coverage = {"error": str(e)}
            
        result = EvaluationResult(
            environment_path=env_path,
            requirements_data=requirements_data,
            info_logger_data={},
            verification_summary="Evaluation timed out",
            atg_coverage=atg_coverage,
            coverage={},
            token_usage={},
            total_cost=0.0,
            verified_tests=0,
            unverified_requirements=[],
            used_atg_identifier_fallback=False,
            used_atg_testable_functions_fallback=False,
            timed_out=True,
            execution_time=timeout_minutes * 60,
            generation_error=f"Evaluation timed out after {timeout_minutes} minutes"
        )
        env.cleanup()
    except Exception as e:
        # Handle any other exceptions
        execution_time = time.perf_counter() - start_time
        error_msg = f"Evaluation failed: {str(e)}\n{''.join(traceback.format_exc())}"
        
        # Create a basic result with error information
        result = EvaluationResult(
            environment_path=env_path,
            requirements_data={req_id: rm.get_requirement(req_id) for req_id in (requirement_ids or rm.requirement_ids)},
            info_logger_data={},
            verification_summary="Evaluation failed with an error",
            atg_coverage={},
            coverage={},
            token_usage={},
            total_cost=0.0,
            verified_tests=0,
            unverified_requirements=[],
            used_atg_identifier_fallback=False,
            used_atg_testable_functions_fallback=False,
            execution_time=execution_time,
            generation_error=error_msg
        )
    else:
        # Calculate execution time and add it to the result
        execution_time = time.perf_counter() - start_time
        result.execution_time = execution_time
        
    return result

async def evaluate_environment(
    env_path: str,
    rm: RequirementsManager,
    output_dir: Path,
    requirement_ids: List[str] = None,
    extended_reasoning: bool = False,
    allow_partial: bool = False,
    batched: bool = True,
    batch_size: int = 8,
    max_retries: int = 2,
    allow_batch_partial: bool = False
) -> EvaluationResult:
    start_time = time.perf_counter()
    env = Environment(env_path)

    env.build()
    
    if not requirement_ids:
        requirement_ids = rm.requirement_ids

    test_generator = TestGenerator(rm, env, use_extended_reasoning=extended_reasoning)
    test_verifier = TestVerifier(rm, env, allow_partial=allow_partial or allow_batch_partial)
    
    # Collect requirements data
    requirements_data = {req_id: rm.get_requirement(req_id) for req_id in requirement_ids}
    
    # Get ATG coverage before running our tests
    atg_coverage = env.atg_coverage
    
    # Generate tests with progress bar
    test_cases = []
    generation_error = None
    pbar = tqdm(total=len(requirement_ids), desc=f"Generating tests for {Path(env_path).stem}")
    try:
        async for test_case in test_generator.generate_test_cases(
            requirement_ids,
            batched=batched,
            allow_partial=allow_partial,
            batch_size=batch_size,
            max_retries=max_retries,
            allow_batch_partial=allow_batch_partial
        ):
            if test_case:
                test_cases.append(test_case)
            pbar.update(1)
    except Exception as e:
        generation_error = f"Test generation failed: {str(e)}\n{''.join(traceback.format_exc())}"
        logging.error(f"Test generation failed for {env_path}: {str(e)}")
    finally:
        pbar.close()

    non_null_tests = [tc for tc in test_cases if tc is not None]

    # Verify tests in parallel while preserving order
    verification_results = []
    pbar = tqdm(total=len(non_null_tests), desc=f"Verifying tests for {Path(env_path).stem}")
    
    # Create a list of coroutines for verification
    verification_tasks = [test_verifier.verify_test_case(test_case) for test_case in non_null_tests]
    
    async def verify_with_progress(coro):
        result = await coro
        pbar.update(1)
        return result
    
    # Wrap each verification task with progress tracking
    wrapped_tasks = [verify_with_progress(task) for task in verification_tasks]
    
    # Wait for all verifications to complete while preserving order
    verification_results = await asyncio.gather(*wrapped_tasks)
    
    pbar.close()

    # Calculate verified tests count
    verified_tests = sum(1 for vr in verification_results if vr.tests_requirement)

    # Get unverified requirements
    problem_reqs = []
    for tc, vr in zip(non_null_tests, verification_results):
        if not vr.tests_requirement:
            problem_reqs.append(tc.requirement_id)

    # Get info logger data
    info_data = test_generator.info_logger.data

    # Export results
    env_output_dir = output_dir / Path(env_path).stem
    env_output_dir.mkdir(parents=True, exist_ok=True)

    # Export test cases
    generated_tests_coverage = {}
    if test_cases:
        with open(env_output_dir / "test_cases.json", "w") as f:
            json.dump([tc.model_dump() for tc in test_cases if tc], f, indent=2)
        
        with open(env_output_dir / "test_cases.tst", "w") as f:
            for tc in test_cases:
                if tc:
                    f.write(tc.to_vectorcast() + "\n")

        # Run tests to get coverage
        tst_file_path = env_output_dir / "test_cases.tst"
        try:
            output, coverage = env.run_test_script(str(tst_file_path), with_coverage=True)
            generated_tests_coverage = coverage
        except Exception as e:
            logging.error(f"Error getting coverage for generated tests: {str(e)}")
            generated_tests_coverage = {"error": str(e)}

    # Export verification results
    with open(env_output_dir / "verification_results.json", "w") as f:
        json.dump([{
            "requirement_id": tc.requirement_id if tc else "unknown",
            "tests_requirement": vr.tests_requirement,
            "confidence": vr.confidence,
            "analysis": vr.analysis
        } for tc, vr in zip(non_null_tests, verification_results)], f, indent=2)

    token_usage = test_generator.llm_client.get_token_usage()
    total_cost = test_generator.llm_client.total_cost['total_cost']

    # After verification results are collected, generate a summary
    verification_context = "\n\n".join([
        f"Requirement {tc.requirement_id if tc else 'unknown'}:\n"
        f"Analysis: {vr.analysis}\n"
        f"Tests Requirement: {vr.tests_requirement}"
        for tc, vr in zip(test_cases, verification_results)
    ])

    summary_engine = SummaryEngine(verification_context)
    verification_summary = await summary_engine.summarize(
        "Summarize the main verification problems and patterns found across all test cases. "
        "Focus on common issues, types of failures, and any notable patterns in the verification results. "
        "Structure your summary with bullet points for key findings."
        "Provide examples (and provide the requirement ID) to illustrate your points."
    )
    
    execution_time = time.perf_counter() - start_time

    env.cleanup()

    return EvaluationResult(
        # Basic information
        environment_path=env_path,
        
        # Raw data needed for calculations
        requirements_data=requirements_data,
        info_logger_data=dict(info_data),
        verification_summary=verification_summary,
        atg_coverage=atg_coverage,
        coverage=generated_tests_coverage,
        token_usage=token_usage,
        total_cost=total_cost,
        
        # Verification data
        verified_tests=verified_tests,
        unverified_requirements=problem_reqs,
        
        # Fallback information
        used_atg_identifier_fallback=getattr(env, '_used_atg_identifier_fallback', False),
        used_atg_testable_functions_fallback=getattr(env, '_used_atg_testable_functions_fallback', False),
        
        # Execution information
        execution_time=execution_time,
        
        # Error information
        generation_error=generation_error
    )

def parse_env_req_pair(pair: str) -> tuple[str, str]:
    """Parse environment:requirements pair, defaulting to reqs.csv in env directory."""
    if ':' in pair:
        env_path, req_path = pair.split(':', 1)
        return env_path, req_path
    else:
        env_path = pair
        env_dir = str(Path(env_path).parent)
        return env_path, str(Path(env_dir) / "reqs.csv")

def write_env_result(result: EvaluationResult, output_dir: Path) -> None:
    """Write individual environment results to a JSON file."""
    env_name = Path(result.environment_path).stem
    result_path = output_dir / f"{env_name}_result.json"
    with open(result_path, "w") as f:
        json.dump(result.model_dump(by_alias=True), f, indent=2)

def get_processed_environments(output_dir: Path) -> set:
    """Get set of environment names that have already been processed."""
    return {
        p.stem.replace("_result", "") 
        for p in output_dir.glob("*_result.json")
    }

async def main():
    parser = argparse.ArgumentParser(description='Evaluate test generation and verification for given environments.')
    parser.add_argument('env_req_pairs', nargs='+', 
                       help='Paths to VectorCAST environment files, optionally followed by :path/to/reqs.csv. '
                            'If no requirements path is specified, looks for reqs.csv in the environment directory.')
    parser.add_argument('output_dir', help='Directory to store evaluation results.')
    parser.add_argument('--requirement-ids', nargs='*', help='Specific requirement IDs to evaluate.')
    parser.add_argument('--extended-reasoning', action='store_true', help='Use extended reasoning.')
    parser.add_argument('--allow-partial', action='store_true', help='Allow partial test generation.')
    parser.add_argument('--batch-size', type=int, default=8, help='Batch size for test generation.')
    parser.add_argument('--batched', action='store_true', help='Enable batched processing.')
    parser.add_argument('--retries', type=int, default=2, help='Number of retries for test generation.')
    parser.add_argument('--allow-batch-partial', action='store_true', 
                       help='Allow partial test generation during batch processing.')
    parser.add_argument('--max-cost', type=float, 
                       help='Maximum cost limit in dollar. Processing stops if exceeded.')
    parser.add_argument('--timeout', type=float, default=30.0,
                        help='Maximum time in minutes to wait for environment evaluation (default: 30)')
    parser.add_argument('--no-skip-existing', action='store_true', 
                       help='Re-process environments even if they have already been evaluated.')
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Get already processed environments
    processed_envs = get_processed_environments(output_dir)
    
    all_results = []
    total_cost = 0.0
    env_pbar = tqdm(args.env_req_pairs, desc="Processing environments")
    for pair in env_pbar:
        if args.max_cost and total_cost >= args.max_cost:
            print(f"\nStopping: Cost limit of ${args.max_cost:.2f} reached (current: ${total_cost:.2f})")
            break

        env_path, req_path = parse_env_req_pair(pair)
        env_name = Path(env_path).stem
        
        # Skip if already processed
        if env_name in processed_envs and not args.no_skip_existing:
            env_pbar.set_description(f"Skipping {env_name}")
            # Load existing result
            with open(output_dir / f"{env_name}_result.json") as f:
                result_dict = json.load(f)
                # Add cost from previous run
                total_cost += result_dict.get('total_cost', 0)
            continue

        env_pbar.set_description(f"Processing {env_name}")
        
        if not os.path.exists(req_path):
            print(f"Warning: Requirements file not found at {req_path}, skipping {env_path}...")
            continue
        
        # Load environment-specific requirements
        env = Environment(env_path)
        try:
            rm = RequirementsManager(req_path)
        except Exception as e:
            print(f"Error loading requirements for {env_path}: {e}")
            env.cleanup()
            continue
            
        result = await evaluate_environment_with_timeout(
            env_path,
            rm,
            output_dir,
            args.requirement_ids,
            args.extended_reasoning,
            args.allow_partial,
            args.batched,
            args.batch_size,
            args.retries,
            args.allow_batch_partial,
            args.timeout
        )
        
        # Write result immediately after processing each environment
        write_env_result(result, output_dir)
        
        all_results.append(result)
        total_cost += result.total_cost
        print(f"Current cost: ${total_cost:.2f}")
        print(f"Execution time: {format_time(result.execution_time)}")
        if result.timed_out:
            print(f"WARNING: Evaluation timed out after {args.timeout} minutes")
        env.cleanup()

    # Remove the export summary section that writes the combined file
    # Instead just print the final summary
    
    # Print summary (replacing logging.info calls)
    print("\nEvaluation Summary:")
    for result in all_results:
        print(f"\n{'=' * 50}")
        print(f"Environment: {result.environment_path}")
        print(f"{'=' * 50}")
        
        # Execution Information
        print(f"\nExecution Information:")
        print(f"Execution Time: {format_time(result.execution_time)}")
        if result.timed_out:
            print(f"STATUS: TIMED OUT after {result.execution_time / 60:.2f} minutes")
        
        # Core metrics
        print(f"\nCore Metrics:")
        print(f"Total Requirements: {result.total_requirements}")
        print(f"Generated Tests: {result.generated_tests}")
        print(f"Verified Tests: {result.verified_tests}")
        
        # Performance metrics
        print(f"\nPerformance Metrics:")
        print(f"Precision: {result.precision:.2f}")
        print(f"Recall: {result.recall:.2f}")
        print(f"F1 Score: {result.f1_score:.2f}")
        
        # Coverage information
        print("\nCoverage Information:")
        print("ATG Coverage:")
        if result.atg_coverage and isinstance(result.atg_coverage, dict):
            if 'statements' in result.atg_coverage:
                stmts = result.atg_coverage['statements']
                print(f"  Statements: {stmts['covered']}/{stmts['total']} ({stmts['percentage']:.2%})")
            if 'branches' in result.atg_coverage:
                branches = result.atg_coverage['branches']
                print(f"  Branches:   {branches['covered']}/{branches['total']} ({branches['percentage']:.2%})")
        else:
            print("  No ATG coverage data available")
            
        print("Generated Tests Coverage:")
        if result.coverage and isinstance(result.coverage, dict):
            if 'statements' in result.coverage:
                stmts = result.coverage['statements']
                print(f"  Statements: {stmts['covered']}/{stmts['total']} ({stmts['percentage']:.2%})")
            if 'branches' in result.coverage:
                branches = result.coverage['branches']
                print(f"  Branches:   {branches['covered']}/{branches['total']} ({branches['percentage']:.2%})")
        else:
            print("  No coverage data available for generated tests")
        
        # Verification information
        print("\nVerification Information:")
        if result.unverified_requirements:
            print(f"Unverified Requirements: {', '.join(result.unverified_requirements)}")
        print("\nVerification Summary:")
        print(result.verification_summary)
        
        # Generation statistics
        print("\nGeneration Statistics:")
        
        # Success/failure
        print(f"\n  Success/Failure:")
        print(f"  Failed Generation Rate: {result.failed_generation_rate:.2%}")
        if result.failed_generation_reqs:
            print(f"  Failed Requirements: {', '.join(result.failed_generation_reqs)}")
        
        # Feedback and correction
        print(f"\n  Feedback and Correction:")
        print(f"  Test Failure Feedback Rate: {result.test_failure_feedback_rate:.2%}")
        if result.test_failure_feedback_reqs:
            print(f"  Test Failure Requirements: {', '.join(result.test_failure_feedback_reqs)}")
        
        print(f"  Error Correction Needed Rate: {result.error_correction_needed_rate:.2%}")
        if result.error_correction_needed_reqs:
            print(f"  Error Correction Requirements: {', '.join(result.error_correction_needed_reqs)}")
        
        # Partial and individual
        print(f"\n  Partial and Individual:")
        print(f"  Partial Test Rate: {result.partial_test_rate:.2%}")
        if result.partial_test_reqs:
            print(f"  Partial Test Requirements: {', '.join(result.partial_test_reqs)}")
        
        print(f"  Individual Generation Rate: {result.individual_generation_rate:.2%}")
        if result.individual_generation_reqs:
            print(f"  Individual Generation Requirements: {', '.join(result.individual_generation_reqs)}")
        
        # Schema and identifiers
        print(f"\n  Schema and Identifiers:")
        print(f"  Found Allowed Identifiers Rate: {result.found_allowed_identifiers_rate:.2%}")
        if result.found_allowed_identifiers_reqs:
            print(f"  Found Allowed Identifiers Requirements: {', '.join(result.found_allowed_identifiers_reqs)}")
        
        print(f"  Schema Exceeded Size Rate: {result.schema_exceeded_size_rate:.2%}")
        if result.schema_exceeded_size_reqs:
            print(f"  Schema Exceeded Size Requirements: {', '.join(result.schema_exceeded_size_reqs)}")
        
        print(f"  Found ATG Examples Rate: {result.found_atg_examples_rate:.2%}")
        if result.found_atg_examples_reqs:
            print(f"  Found ATG Examples Requirements: {', '.join(result.found_atg_examples_reqs)}")

        print(f"  Used Code Context Fallback Rate: {result.used_code_context_fallback_rate:.2%}")
        if result.used_code_context_fallback_reqs:
            print(f"  Used Code Context Fallback Requirements: {', '.join(result.used_code_context_fallback_reqs)}")
        
        # Fallback information
        print("\nEnvironment-level Fallback Information:")
        print(f"Used ATG Identifier Fallback: {result.used_atg_identifier_fallback}")
        print(f"Used ATG Testable Functions Fallback: {result.used_atg_testable_functions_fallback}")
        
        # Cost information
        print("\nCost Information:")
        print(f"Total Cost: ${result.total_cost:.4f}")
        
        # Error information
        if result.generation_error:
            print("\nGeneration Error:")
            print(result.generation_error[:500] + "..." if len(result.generation_error) > 500 else result.generation_error)

def format_time(seconds):
    """Format seconds into human-readable time format"""
    if seconds < 60:
        return f"{seconds:.2f} seconds"
    elif seconds < 3600:
        minutes = seconds / 60
        return f"{minutes:.2f} minutes"
    else:
        hours = seconds / 3600
        return f"{hours:.2f} hours"

def cli():
    asyncio.run(main())

if __name__ == '__main__':
    cli()
