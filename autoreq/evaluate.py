import json
import os
import argparse
import asyncio
import logging
import csv
from pathlib import Path
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, asdict
from tqdm import tqdm

from .requirements_manager import RequirementsManager
from .test_generation.generation import TestGenerator
from .test_generation.environment import Environment
from .test_verification.verification import TestVerifier

@dataclass
class EvaluationResult:
    environment_path: str
    total_requirements: int
    generated_tests: int
    verified_tests: int
    precision: float
    recall: float
    f1_score: float
    total_cost: float
    token_usage: Dict[str, Dict[str, int]]
    unverified_requirements: List[str]
    failed_generation_reqs: List[str]
    failed_generation_rate: float
    test_failure_feedback_reqs: List[str]
    test_failure_feedback_rate: float
    partial_test_reqs: List[str]
    partial_test_rate: float
    individual_generation_reqs: List[str]
    individual_generation_rate: float

async def evaluate_environment(
    env_path: str,
    rm: RequirementsManager,
    output_dir: Path,
    requirement_ids: List[str] = None,
    extended_reasoning: bool = False,
    allow_partial: bool = False,
    batched: bool = True,
    batch_size: int = 8,
    max_retries: int = 2
) -> EvaluationResult:
    env = Environment(env_path)
    
    if not requirement_ids:
        requirement_ids = rm.requirement_ids

    test_generator = TestGenerator(rm, env, use_extended_reasoning=extended_reasoning)
    test_verifier = TestVerifier(rm, env)
    
    # Generate tests with progress bar
    test_cases = []
    pbar = tqdm(total=len(requirement_ids), desc=f"Generating tests for {Path(env_path).stem}")
    async for test_case in test_generator.generate_test_cases(
        requirement_ids,
        batched=batched,
        allow_partial=allow_partial,
        batch_size=batch_size,
        max_retries=max_retries
    ):
        if test_case:
            test_cases.append(test_case)
        pbar.update(1)
    pbar.close()

    non_null_tests = [tc for tc in test_cases if tc is not None]

    # Verify tests with progress bar
    verification_results = []
    pbar = tqdm(total=len(non_null_tests), desc=f"Verifying tests for {Path(env_path).stem}")
    for test_case in non_null_tests:
        result = await test_verifier.verify_test_case(test_case)
        verification_results.append(result)
        pbar.update(1)
    pbar.close()

    # Calculate metrics
    total_reqs = len(requirement_ids)
    verified_tests = sum(1 for vr in verification_results if vr.tests_requirement)
    generated_tests = len(non_null_tests)
    
    precision = verified_tests / len(verification_results) if verification_results else 0
    recall = verified_tests / total_reqs if total_reqs > 0 else 0
    f1_score = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0

    # Get problem requirements
    problem_reqs = []
    for tc, vr in zip(test_cases, verification_results):
        if tc and not vr.tests_requirement:
            problem_reqs.append(tc.requirement_id)

    # Get info logger data
    info_data = test_generator.info_logger.data
    
    # Collect metrics from info logger
    failed_generation_reqs = [req_id for req_id, data in info_data.items()
                            if not data['test_generated']]
    
    test_failure_feedback_reqs = [req_id for req_id, data in info_data.items()
                                if data['test_run_failure_feedback'] and data['test_generated']]
    
    partial_test_reqs = [req_id for req_id, data in info_data.items()
                        if data['partial_test_generated']]
    
    individual_generation_reqs = [req_id for req_id, data in info_data.items()
                                if data['individual_test_generation_needed']]
    
    # Calculate rates
    failed_generation_rate = len(failed_generation_reqs) / total_reqs if total_reqs > 0 else 0
    test_failure_feedback_rate = len(test_failure_feedback_reqs) / total_reqs if total_reqs > 0 else 0
    partial_test_rate = len(partial_test_reqs) / total_reqs if total_reqs > 0 else 0
    individual_generation_rate = len(individual_generation_reqs) / total_reqs if total_reqs > 0 else 0

    # Export results
    env_output_dir = output_dir / Path(env_path).stem
    env_output_dir.mkdir(parents=True, exist_ok=True)

    # Export test cases
    if test_cases:
        with open(env_output_dir / "test_cases.json", "w") as f:
            json.dump([tc.model_dump() for tc in test_cases if tc], f, indent=2)
        
        with open(env_output_dir / "test_cases.tst", "w") as f:
            for tc in test_cases:
                if tc:
                    f.write(tc.to_vectorcast() + "\n")

    # Export verification results
    with open(env_output_dir / "verification_results.json", "w") as f:
        json.dump([{
            "requirement_id": tc.requirement_id if tc else "unknown",
            "tests_requirement": vr.tests_requirement,
            "confidence": vr.confidence,
            "analysis": vr.analysis
        } for tc, vr in zip(test_cases, verification_results)], f, indent=2)

    token_usage = test_generator.llm_client.get_token_usage()
    total_cost = test_generator.llm_client.total_cost['total_cost']

    env.cleanup()

    return EvaluationResult(
        environment_path=env_path,
        total_requirements=total_reqs,
        generated_tests=generated_tests,
        verified_tests=verified_tests,
        precision=precision,
        recall=recall,
        f1_score=f1_score,
        total_cost=total_cost,
        token_usage=token_usage,
        unverified_requirements=problem_reqs,
        failed_generation_reqs=failed_generation_reqs,
        failed_generation_rate=failed_generation_rate,
        test_failure_feedback_reqs=test_failure_feedback_reqs,
        test_failure_feedback_rate=test_failure_feedback_rate,
        partial_test_reqs=partial_test_reqs,
        partial_test_rate=partial_test_rate,
        individual_generation_reqs=individual_generation_reqs,
        individual_generation_rate=individual_generation_rate
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
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    all_results = []
    env_pbar = tqdm(args.env_req_pairs, desc="Processing environments")
    for pair in env_pbar:
        env_path, req_path = parse_env_req_pair(pair)
        env_name = Path(env_path).stem
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
            
        result = await evaluate_environment(
            env_path,
            rm,
            output_dir,
            args.requirement_ids,
            args.extended_reasoning,
            args.allow_partial,
            args.batched,
            args.batch_size,
            args.retries
        )
        all_results.append(result)
        env.cleanup()

    # Export summary
    with open(output_dir / "evaluation_summary.json", "w") as f:
        json.dump({
            "environments": [asdict(r) for r in all_results],
            "overall": {
                "total_environments": len(all_results),
                "total_cost": sum(r.total_cost for r in all_results),
                "average_precision": sum(r.precision for r in all_results) / len(all_results),
                "average_recall": sum(r.recall for r in all_results) / len(all_results),
                "average_f1": sum(r.f1_score for r in all_results) / len(all_results),
                "average_failed_generation_rate": sum(r.failed_generation_rate for r in all_results) / len(all_results),
                "average_test_failure_feedback_rate": sum(r.test_failure_feedback_rate for r in all_results) / len(all_results),
                "average_partial_test_rate": sum(r.partial_test_rate for r in all_results) / len(all_results),
                "average_individual_generation_rate": sum(r.individual_generation_rate for r in all_results) / len(all_results),
            }
        }, f, indent=2)

    # Print summary (replacing logging.info calls)
    print("\nEvaluation Summary:")
    for result in all_results:
        print(f"\nEnvironment: {result.environment_path}")
        print(f"Total Requirements: {result.total_requirements}")
        print(f"Generated Tests: {result.generated_tests}")
        print(f"Verified Tests: {result.verified_tests}")
        print(f"Precision: {result.precision:.2f}")
        print(f"Recall: {result.recall:.2f}")
        print(f"F1 Score: {result.f1_score:.2f}")
        print(f"Total Cost: ${result.total_cost:.4f}")
        if result.unverified_requirements:
            print(f"Unverified Requirements (test does not properly test requirement): {', '.join(result.unverified_requirements)}")
        print("\nGeneration Statistics:")
        print(f"Failed Generation Rate: {result.failed_generation_rate:.2%}")
        if result.failed_generation_reqs:
            print(f"Failed Generation Requirements: {', '.join(result.failed_generation_reqs)}")
        
        print(f"Test Failure Feedback Rate: {result.test_failure_feedback_rate:.2%}")
        if result.test_failure_feedback_reqs:
            print(f"Test Failure Feedback Requirements: {', '.join(result.test_failure_feedback_reqs)}")
        
        print(f"Partial Test Rate: {result.partial_test_rate:.2%}")
        if result.partial_test_reqs:
            print(f"Partial Test Requirements: {', '.join(result.partial_test_reqs)}")
        
        print(f"Individual Generation Rate: {result.individual_generation_rate:.2%}")
        if result.individual_generation_reqs:
            print(f"Individual Generation Requirements: {', '.join(result.individual_generation_reqs)}")

def cli():
    asyncio.run(main())

if __name__ == '__main__':
    cli()
