import json
import os
import argparse
import asyncio
import logging
import time
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from pydantic import BaseModel, Field, computed_field
from tqdm import tqdm
import traceback
from datetime import datetime

from autoreq.test_generation.requirement_decomposition import decompose_requirements

from autoreq.requirements_manager import (
    DecomposingRequirementsManager,
    RequirementsManager,
)
from autoreq.test_generation.generation import TestGenerator
from autoreq.test_generation.environment import Environment
from autoreq.test_verification.verification import TestVerifier
from autoreq.coverage_extraction.requirement_coverage import RequirementCoverage


class EvaluationResult(BaseModel):
    # Basic information
    environment_path: str

    # Raw data needed for calculations
    requirements_data: Dict[str, Any]
    info_logger_data: Dict[str, Any]
    verification_results: List[Dict[str, Any]] = Field(default_factory=list)

    # Coverage data
    atg_coverage: Optional[Dict[str, Any]]
    coverage: Optional[Dict[str, Any]]

    # Requirement coverage data
    requirement_coverage_results: List[Dict[str, Any]] = Field(default_factory=list)

    # Token usage data
    token_usage: Dict[str, Dict[str, int]]
    total_generation_cost: float  # Renamed from total_cost
    total_verification_cost: float = 0.0

    # Verification data
    verified_tests: int
    unverified_requirements: List[str]

    # Optional error information
    generation_error: Optional[str] = None

    # Execution information
    execution_time: float
    timed_out: bool = False

    @computed_field
    def total_requirements(self) -> int:
        return len(self.requirements_data)

    @computed_field
    def generated_tests(self) -> int:
        return len(
            [
                req_id
                for req_id, data in self.info_logger_data.items()
                if data['test_generated']
            ]
        )

    @computed_field
    def precision(self) -> float:
        return (
            self.verified_tests / self.generated_tests
            if self.generated_tests > 0
            else 0
        )

    @computed_field
    def recall(self) -> float:
        return (
            self.verified_tests / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def f1_score(self) -> float:
        if (self.precision + self.recall) > 0:
            return 2 * (self.precision * self.recall) / (self.precision + self.recall)
        return 0

    @computed_field
    def requirement_coverage(self) -> float:
        fully_covered = sum(
            1 if res['fully_covered'] else 0
            for res in self.requirement_coverage_results
        )
        return (
            fully_covered / self.total_requirements
            if self.requirement_coverage_results
            else 0
        )

    @computed_field
    def failed_generation_reqs(self) -> List[str]:
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if not data['test_generated']
        ]

    @computed_field
    def failed_generation_rate(self) -> float:
        return (
            len(self.failed_generation_reqs) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def test_failure_feedback_reqs(self) -> List[str]:
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if data['test_run_failure_feedback'] and data['test_generated']
        ]

    @computed_field
    def test_failure_feedback_rate(self) -> float:
        return (
            len(self.test_failure_feedback_reqs) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def error_correction_needed_reqs(self) -> List[str]:
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if data['error_correction_needed']
        ]

    @computed_field
    def error_correction_needed_rate(self) -> float:
        return (
            len(self.error_correction_needed_reqs) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def partial_test_reqs(self) -> List[str]:
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if data['partial_test_generated']
        ]

    @computed_field
    def partial_test_rate(self) -> float:
        return (
            len(self.partial_test_reqs) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def individual_generation_reqs(self) -> List[str]:
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if data['individual_test_generation_needed']
        ]

    @computed_field
    def individual_generation_rate(self) -> float:
        return (
            len(self.individual_generation_reqs) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def found_no_allowed_identifiers_reqs(self) -> List[str]:
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if data['found_no_allowed_identifiers']
        ]

    @computed_field
    def found_no_allowed_identifiers_rate(self) -> float:
        return (
            len(self.found_no_allowed_identifiers_reqs) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def schema_exceeded_size_reqs(self) -> List[str]:
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if data['schema_exceeded_size']
        ]

    @computed_field
    def schema_exceeded_size_rate(self) -> float:
        return (
            len(self.schema_exceeded_size_reqs) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def no_atg_examples_reqs(self) -> List[str]:
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if data['no_atg_examples']
        ]

    @computed_field
    def no_atg_examples_rate(self) -> float:
        return (
            len(self.no_atg_examples_reqs) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def used_code_context_fallback_reqs(self) -> List[str]:
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if data['used_code_context_fallback']
        ]

    @computed_field
    def used_code_context_fallback_rate(self) -> float:
        return (
            len(self.used_code_context_fallback_reqs) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def used_atg_identifier_fallback_reqs(self) -> List[str]:
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if data['used_atg_identifier_fallback']
        ]

    @computed_field
    def used_atg_identifier_fallback_rate(self) -> float:
        return (
            len(self.used_atg_identifier_fallback_reqs) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def reqs_with_exceptions(self) -> List[str]:
        """List requirement IDs that had exceptions during processing."""
        return [
            req_id
            for req_id, data in self.info_logger_data.items()
            if data['exceptions'] and len(data['exceptions']) > 0
        ]

    @computed_field
    def exception_rate(self) -> float:
        """Calculate the percentage of requirements that had exceptions."""
        return (
            len(self.reqs_with_exceptions) / self.total_requirements
            if self.total_requirements > 0
            else 0
        )

    @computed_field
    def total_cost(self) -> float:
        """Combined cost of both generation and verification"""
        return self.total_generation_cost + self.total_verification_cost

    def __str__(self) -> str:
        """Format the evaluation result as a human-readable string"""
        lines = []

        # Header for the environment
        lines.append(f'\n{"=" * 50}')
        lines.append(f'Environment: {self.environment_path}')
        lines.append(f'{"=" * 50}')

        # Execution Information
        lines.append(f'\nExecution Information:')
        lines.append(f'Execution Time: {format_time(self.execution_time)}')
        if self.timed_out:
            lines.append(
                f'STATUS: TIMED OUT after {self.execution_time / 60:.2f} minutes'
            )

        # Core metrics
        lines.append(f'\nCore Metrics:')
        lines.append(f'Total Requirements: {self.total_requirements}')
        lines.append(f'Generated Tests: {self.generated_tests}')
        lines.append(f'Verified Tests: {self.verified_tests}')

        # Performance metrics
        lines.append(f'\nPerformance Metrics:')
        lines.append(f'Precision: {self.precision:.2f}')
        lines.append(f'Recall: {self.recall:.2f}')
        lines.append(f'F1 Score: {self.f1_score:.2f}')

        # Coverage information
        lines.append('\nCoverage Information:')
        lines.append('ATG Coverage:')
        if self.atg_coverage and isinstance(self.atg_coverage, dict):
            if 'statements' in self.atg_coverage:
                stmts = self.atg_coverage['statements']
                lines.append(
                    f'  Statements: {stmts["covered"]}/{stmts["total"]} ({stmts["percentage"]:.2%})'
                )
            if 'branches' in self.atg_coverage:
                branches = self.atg_coverage['branches']
                lines.append(
                    f'  Branches:   {branches["covered"]}/{branches["total"]} ({branches["percentage"]:.2%})'
                )
        else:
            lines.append('  No ATG coverage data available')

        lines.append('Generated Tests Coverage:')
        if self.coverage and isinstance(self.coverage, dict):
            if 'statements' in self.coverage:
                stmts = self.coverage['statements']
                lines.append(
                    f'  Statements: {stmts["covered"]}/{stmts["total"]} ({stmts["percentage"]:.2%})'
                )
            if 'branches' in self.coverage:
                branches = self.coverage['branches']
                lines.append(
                    f'  Branches:   {branches["covered"]}/{branches["total"]} ({branches["percentage"]:.2%})'
                )
        else:
            lines.append('  No coverage data available for generated tests')

        # Requirement coverage
        if self.requirement_coverage_results:
            lines.append(f'\nRequirement Coverage: {self.requirement_coverage:.2%}')
            uncovered_reqs = [
                req['requirement_id']
                for req in self.requirement_coverage_results
                if not req['fully_covered']
            ]
            if uncovered_reqs:
                lines.append(f'Uncovered Requirements: {", ".join(uncovered_reqs)}')

        # Verification information
        lines.append('\nVerification Information:')
        lines.append(f'Verified Tests: {self.verified_tests}/{self.generated_tests}')
        if self.unverified_requirements:
            lines.append(
                f'Unverified Requirements: {", ".join(self.unverified_requirements)}'
            )

        # Generation statistics
        lines.append('\nGeneration Statistics:')

        # Success/failure
        lines.append(f'\n  Success/Failure:')
        lines.append(f'  Failed Generation Rate: {self.failed_generation_rate:.2%}')
        if self.failed_generation_reqs:
            lines.append(
                f'  Failed Requirements: {", ".join(self.failed_generation_reqs)}'
            )

        # Feedback and correction
        lines.append(f'\n  Fallback rates:')
        lines.append(
            f'  Test Failure Feedback Rate: {self.test_failure_feedback_rate:.2%}'
        )
        if self.test_failure_feedback_reqs:
            lines.append(
                f'  Test Failure Requirements: {", ".join(self.test_failure_feedback_reqs)}'
            )

        lines.append(
            f'  Error Correction Needed Rate: {self.error_correction_needed_rate:.2%}'
        )
        if self.error_correction_needed_reqs:
            lines.append(
                f'  Error Correction Requirements: {", ".join(self.error_correction_needed_reqs)}'
            )

        lines.append(f'  Partial Test Rate: {self.partial_test_rate:.2%}')
        if self.partial_test_reqs:
            lines.append(
                f'  Partial Test Requirements: {", ".join(self.partial_test_reqs)}'
            )

        lines.append(
            f'  Individual Generation Rate: {self.individual_generation_rate:.2%}'
        )
        if self.individual_generation_reqs:
            lines.append(
                f'  Individual Generation Requirements: {", ".join(self.individual_generation_reqs)}'
            )

        lines.append(
            f'  Found No Allowed Identifiers Rate: {self.found_no_allowed_identifiers_rate:.2%}'
        )
        if self.found_no_allowed_identifiers_reqs:
            lines.append(
                f'  Found No Allowed Identifiers Requirements: {", ".join(self.found_no_allowed_identifiers_reqs)}'
            )

        lines.append(
            f'  Schema Exceeded Size Rate: {self.schema_exceeded_size_rate:.2%}'
        )
        if self.schema_exceeded_size_reqs:
            lines.append(
                f'  Schema Exceeded Size Requirements: {", ".join(self.schema_exceeded_size_reqs)}'
            )

        lines.append(f'  No ATG Examples Rate: {self.no_atg_examples_rate:.2%}')
        if self.no_atg_examples_reqs:
            lines.append(
                f'  No ATG Examples Requirements: {", ".join(self.no_atg_examples_reqs)}'
            )

        lines.append(
            f'  Used Code Context Fallback Rate: {self.used_code_context_fallback_rate:.2%}'
        )
        if self.used_code_context_fallback_reqs:
            lines.append(
                f'  Used Code Context Fallback Requirements: {", ".join(self.used_code_context_fallback_reqs)}'
            )

        lines.append(
            f'  Used ATG Identifier Fallback Rate: {self.used_atg_identifier_fallback_rate:.2%}'
        )
        if self.used_atg_identifier_fallback_reqs:
            lines.append(
                f'  Used ATG Identifier Fallback Requirements: {", ".join(self.used_atg_identifier_fallback_reqs)}'
            )

        # Exception information
        lines.append(f'\n  Exception Information:')
        lines.append(f'  Requirements with Exceptions Rate: {self.exception_rate:.2%}')
        if self.reqs_with_exceptions:
            lines.append(
                f'  Requirements with Exceptions: {", ".join(self.reqs_with_exceptions)}'
            )

        # Cost information
        lines.append('\nCost Information:')
        lines.append(f'Generation Cost: ${self.total_generation_cost:.4f}')
        lines.append(f'Verification Cost: ${self.total_verification_cost:.4f}')
        lines.append(f'Total Cost: ${self.total_cost:.4f}')

        # Error information
        if self.generation_error:
            lines.append('\nGeneration Error:')
            lines.append(self.generation_error)

        return '\n'.join(lines)

    class Config:
        populate_by_name = True


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
    allow_batch_partial: bool = False,
    max_generation_time: float = None,
    min_pruning_lines: int = 1000,
    use_test_examples: bool = True,
) -> EvaluationResult:
    start_time = time.perf_counter()
    env = Environment(env_path)

    env.build()

    if not requirement_ids:
        requirement_ids = rm.requirement_ids

    test_generator = TestGenerator(
        rm,
        env,
        use_extended_reasoning=extended_reasoning,
        min_prune_lines=min_pruning_lines,
        use_test_examples=use_test_examples,
    )
    test_verifier = TestVerifier(
        rm, env, allow_partial=allow_partial or allow_batch_partial
    )

    # Collect requirements data
    requirements_data = {
        req_id: rm.get_requirement(req_id) for req_id in requirement_ids
    }

    # Get ATG coverage before running our tests
    atg_coverage = env.atg_coverage

    # Generate tests with progress bar
    test_cases = []
    generation_error = None
    pbar = tqdm(
        total=len(requirement_ids), desc=f'Generating tests for {Path(env_path).stem}'
    )

    async def perform_test_generation():
        nonlocal test_cases, generation_error
        async for test_case in test_generator.generate_test_cases(
            requirement_ids,
            batched=batched,
            allow_partial=allow_partial,
            batch_size=batch_size,
            max_retries=max_retries,
            allow_batch_partial=allow_batch_partial,
        ):
            if test_case:
                test_cases.append(test_case)
            pbar.update(1)

    try:
        await asyncio.wait_for(perform_test_generation(), timeout=max_generation_time)
    except asyncio.TimeoutError:
        generation_error = (
            f'Test generation timed out after {max_generation_time} seconds'
        )
        logging.error(
            f'Test generation timed out for {env_path} after {max_generation_time} seconds'
        )
    except Exception as e:
        generation_error = (
            f'Test generation failed: {str(e)}\n{"".join(traceback.format_exc())}'
        )
        logging.error(f'Test generation failed for {env_path}: {str(e)}')
    finally:
        pbar.close()

    # Capture generation costs before verification
    generation_token_usage = test_generator.llm_client.get_token_usage()
    generation_total_cost = test_generator.llm_client.total_cost['total_cost']

    non_null_tests = [tc for tc in test_cases if tc is not None]

    # Verify tests in parallel while preserving order
    verification_results = []
    pbar = tqdm(
        total=len(non_null_tests), desc=f'Verifying tests for {Path(env_path).stem}'
    )

    # Create a list of coroutines for verification
    verification_tasks = [
        test_verifier.verify_test_case(test_case) for test_case in non_null_tests
    ]

    async def verify_with_progress(coro):
        result = await coro
        pbar.update(1)
        return result

    # Wrap each verification task with progress tracking
    wrapped_tasks = [verify_with_progress(task) for task in verification_tasks]

    # Wait for all verifications to complete while preserving order
    verification_results = await asyncio.gather(*wrapped_tasks)

    # Capture verification cost
    verification_total_cost = test_verifier.llm_client.total_cost['total_cost']

    pbar.close()

    # Calculate verified tests count
    verified_tests = sum(1 for vr in verification_results if vr.tests_requirement)

    # Get unverified requirements
    problem_reqs = []
    for vr in verification_results:
        if not vr.tests_requirement:
            problem_reqs.append(vr.requirement_id)

    # Get info logger data
    info_data = test_generator.info_logger.data

    # Export results
    env_output_dir = output_dir / Path(env_path).stem
    env_output_dir.mkdir(parents=True, exist_ok=True)

    # Export test cases
    generated_tests_coverage = {}
    if test_cases:
        with open(env_output_dir / 'test_cases.json', 'w') as f:
            json.dump([tc.model_dump() for tc in test_cases if tc], f, indent=2)

        with open(env_output_dir / 'test_cases.tst', 'w') as f:
            f.write('-- VectorCAST 6.4s (05/01/17)\n')
            f.write('-- Test Case Script\n')
            f.write(f'-- Environment    : {env.env_name}\n')
            f.write(f'-- Unit(s) Under Test: {", ".join(env.units)}\n')
            f.write('-- \n')
            f.write('-- Script Features\n')
            f.write('TEST.SCRIPT_FEATURE:C_DIRECT_ARRAY_INDEXING\n')
            f.write('TEST.SCRIPT_FEATURE:CPP_CLASS_OBJECT_REVISION\n')
            f.write('TEST.SCRIPT_FEATURE:MULTIPLE_UUT_SUPPORT\n')
            f.write('TEST.SCRIPT_FEATURE:MIXED_CASE_NAMES\n')
            f.write('TEST.SCRIPT_FEATURE:STATIC_HEADER_FUNCS_IN_UUTS\n\n')
            for tc in test_cases:
                if tc:
                    f.write(tc.to_vectorcast() + '\n')

        # Run tests to get coverage
        tst_file_path = env_output_dir / 'test_cases.tst'
        try:
            output, coverage = env.run_test_script(
                str(tst_file_path), with_coverage=True
            )
            generated_tests_coverage = coverage
        except Exception as e:
            logging.error(f'Error getting coverage for generated tests: {str(e)}')
            generated_tests_coverage = {'error': str(e)}

    # Calculate requirement coverage
    rc = RequirementCoverage(env, rm)
    requirement_coverage_results = []
    for test_case in tqdm(test_cases, desc='Calculating requirement coverage'):
        if test_case is None:
            continue
        result = rc.check_requirement_coverage(
            test_case.requirement_id, [test_case.to_vectorcast(add_uuid=True)]
        )

        if result:
            requirement_coverage_results.append(result.model_dump())

    # Export verification results
    verification_results_data = [
        {
            'requirement_id': vr.requirement_id,
            'tests_requirement': vr.tests_requirement,
            'analysis': vr.analysis,
        }
        for vr in verification_results
    ]

    with open(env_output_dir / 'verification_results.json', 'w') as f:
        json.dump(verification_results_data, f, indent=2)

    token_usage = generation_token_usage

    execution_time = time.perf_counter() - start_time

    env.cleanup()

    return EvaluationResult(
        # Basic information
        environment_path=env_path,
        # Raw data needed for calculations
        requirements_data=requirements_data,
        info_logger_data=dict(info_data),
        verification_results=verification_results_data,
        # Coverage data
        atg_coverage=atg_coverage,
        coverage=generated_tests_coverage,
        # Requirement coverage data
        requirement_coverage_results=requirement_coverage_results,
        # Token usage data
        token_usage=token_usage,
        total_generation_cost=generation_total_cost,
        total_verification_cost=verification_total_cost,
        # Verification data
        verified_tests=verified_tests,
        unverified_requirements=problem_reqs,
        # Execution information
        execution_time=execution_time,
        # Error information
        generation_error=generation_error,
    )


def parse_env_req_pair(pair: str) -> tuple[str, str]:
    """Parse environment:requirements pair, defaulting to reqs.csv in env directory."""
    if ':' in pair:
        env_path, req_path = pair.split(':', 1)
        return env_path, req_path
    else:
        env_path = pair
        env_dir = str(Path(env_path).parent)
        return env_path, str(Path(env_dir) / 'reqs.csv')


def read_environments_from_file(filepath: str) -> List[str]:
    """Read environment paths from a file, one per line."""
    if not os.path.exists(filepath):
        raise FileNotFoundError(f'Environment list file not found: {filepath}')

    with open(filepath, 'r') as f:
        # Read all lines and strip whitespace, skipping empty lines and comments
        return [
            line.strip()
            for line in f.readlines()
            if line.strip() and not line.strip().startswith('#')
        ]


def expand_environment_args(env_args: List[str]) -> List[str]:
    """
    Expand environment arguments, replacing @filepath references with the contents
    of those files.
    """
    expanded_args = []
    for arg in env_args:
        if arg.startswith('@'):
            filepath = arg[1:]  # Remove the @ prefix
            try:
                file_envs = read_environments_from_file(filepath)
                expanded_args.extend(file_envs)
            except Exception as e:
                print(f'Error reading environments from file {filepath}: {e}')
        else:
            expanded_args.append(arg)
    return expanded_args


def write_env_result(result: EvaluationResult, output_dir: Path) -> None:
    """Write individual environment results to a JSON file."""
    env_name = Path(result.environment_path).stem
    result_path = output_dir / f'{env_name}_result.json'
    with open(result_path, 'w') as f:
        json.dump(result.model_dump(by_alias=True), f, indent=2)


def get_processed_environments(output_dir: Path) -> set:
    """Get set of environment names that have already been processed."""
    return {p.stem.replace('_result', '') for p in output_dir.glob('*_result.json')}


def setup_mlflow(mlflow_arg: Tuple[str, str]) -> Optional[Any]:
    """
    Set up MLflow tracking for the evaluation.

    Args:
        mlflow_arg: A tuple of (experiment_name, run_name)

    Returns:
        The MLflow module if successful, None otherwise
    """
    try:
        import mlflow
    except ImportError:
        print('Warning: mlflow is not installed. MLflow tracking is disabled.')
        return None

    # Set longer timeout for artifact uploads
    os.environ['MLFLOW_ARTIFACT_UPLOAD_DOWNLOAD_TIMEOUT'] = '1800'

    mlflow_server = os.environ.get('AUTOREQ_MLFLOW_SERVER')
    # Use server from config if available
    if mlflow_server:
        mlflow.set_tracking_uri(mlflow_server)

    experiment_name, run_name = mlflow_arg
    run_name += f' {datetime.now().strftime("%Y-%m-%d-%H:%M:%S")}'

    # Get or create the experiment
    experiment = mlflow.get_experiment_by_name(experiment_name)
    if not experiment:
        experiment_id = mlflow.create_experiment(experiment_name)
    else:
        experiment_id = experiment.experiment_id

    mlflow.set_experiment(experiment_name)
    mlflow.start_run(run_name=run_name)
    mlflow.set_tag('mlflow.runName', run_name)

    return mlflow


def log_result_to_mlflow(mlflow, result: EvaluationResult, env_name: str) -> None:
    """Log environment evaluation results to MLflow."""
    if not mlflow:
        return

    # Create a metrics dictionary with all available computed metrics
    metrics = {
        # Core metrics
        f'{env_name}/precision': result.precision,
        f'{env_name}/recall': result.recall,
        f'{env_name}/f1_score': result.f1_score,
        f'{env_name}/total_requirements': result.total_requirements,
        f'{env_name}/generated_tests': result.generated_tests,
        f'{env_name}/verified_tests': result.verified_tests,
        # Generation metrics
        f'{env_name}/failed_generation_rate': result.failed_generation_rate,
        f'{env_name}/test_failure_feedback_rate': result.test_failure_feedback_rate,
        f'{env_name}/error_correction_needed_rate': result.error_correction_needed_rate,
        f'{env_name}/partial_test_rate': result.partial_test_rate,
        f'{env_name}/individual_generation_rate': result.individual_generation_rate,
        f'{env_name}/found_no_allowed_identifiers_rate': result.found_no_allowed_identifiers_rate,
        f'{env_name}/schema_exceeded_size_rate': result.schema_exceeded_size_rate,
        f'{env_name}/no_atg_examples_rate': result.no_atg_examples_rate,
        f'{env_name}/used_code_context_fallback_rate': result.used_code_context_fallback_rate,
        f'{env_name}/used_atg_identifier_fallback_rate': result.used_atg_identifier_fallback_rate,
        # Exception metrics
        f'{env_name}/exception_rate': result.exception_rate,
        # Cost and performance metrics
        f'{env_name}/generation_cost': result.total_generation_cost,
        f'{env_name}/verification_cost': result.total_verification_cost,
        f'{env_name}/total_cost': result.total_cost,
        f'{env_name}/execution_time': result.execution_time,
        f'{env_name}/timed_out': int(
            result.timed_out
        ),  # Convert boolean to int for logging
    }

    # Add coverage metrics if available
    if result.atg_coverage and isinstance(result.atg_coverage, dict):
        if 'statements' in result.atg_coverage:
            stmts = result.atg_coverage['statements']
            metrics[f'{env_name}/atg_statement_coverage'] = stmts.get('percentage', 0)
            metrics[f'{env_name}/atg_statements_covered'] = stmts.get('covered', 0)
            metrics[f'{env_name}/atg_statements_total'] = stmts.get('total', 0)

        if 'branches' in result.atg_coverage:
            branches = result.atg_coverage['branches']
            metrics[f'{env_name}/atg_branch_coverage'] = branches.get('percentage', 0)
            metrics[f'{env_name}/atg_branches_covered'] = branches.get('covered', 0)
            metrics[f'{env_name}/atg_branches_total'] = branches.get('total', 0)

    if result.coverage and isinstance(result.coverage, dict):
        if 'statements' in result.coverage:
            stmts = result.coverage['statements']
            metrics[f'{env_name}/statement_coverage'] = stmts.get('percentage', 0)
            metrics[f'{env_name}/statements_covered'] = stmts.get('covered', 0)
            metrics[f'{env_name}/statements_total'] = stmts.get('total', 0)

        if 'branches' in result.coverage:
            branches = result.coverage['branches']
            metrics[f'{env_name}/branch_coverage'] = branches.get('percentage', 0)
            metrics[f'{env_name}/branches_covered'] = branches.get('covered', 0)
            metrics[f'{env_name}/branches_total'] = branches.get('total', 0)

    # Log token usage metrics
    if result.token_usage:
        for model_name, usage in result.token_usage.items():
            for metric_name, value in usage.items():
                metrics[f'{env_name}/tokens_{model_name}_{metric_name}'] = value

    # Log all metrics
    mlflow.log_metrics(metrics)

    # Create environment directory structure for artifacts
    env_artifact_dir = f'environments/{env_name}'

    # Log the full result as a JSON artifact
    mlflow.log_dict(result.model_dump(by_alias=True), f'{env_artifact_dir}/result.json')


async def main():
    parser = argparse.ArgumentParser(
        description='Evaluate test generation and verification for given environments.'
    )
    parser.add_argument(
        'env_req_pairs',
        nargs='+',
        help='Paths to VectorCAST environment files, optionally followed by :path/to/reqs.csv. '
        'If no requirements path is specified, looks for reqs.csv in the environment directory. '
        'You can also use @filepath to include environments listed in a file, one per line.',
    )
    parser.add_argument('output_dir', help='Directory to store evaluation results.')
    parser.add_argument(
        '--requirement-ids', nargs='*', help='Specific requirement IDs to evaluate.'
    )
    parser.add_argument(
        '--extended-reasoning', action='store_true', help='Use extended reasoning.'
    )
    parser.add_argument(
        '--allow-partial', action='store_true', help='Allow partial test generation.'
    )
    parser.add_argument(
        '--batch-size', type=int, default=4, help='Batch size for test generation.'
    )
    parser.add_argument(
        '--batched', action='store_true', help='Enable batched processing.'
    )
    parser.add_argument(
        '--retries', type=int, default=2, help='Number of retries for test generation.'
    )
    parser.add_argument(
        '--allow-batch-partial',
        action='store_true',
        help='Allow partial test generation during batch processing.',
    )
    parser.add_argument(
        '--max-cost',
        type=float,
        help='Maximum cost limit in dollar. Processing stops if exceeded.',
    )
    parser.add_argument(
        '--timeout',
        type=float,
        default=60.0,
        help='Maximum time in minutes to wait for environment evaluation (default: 60)',
    )
    parser.add_argument(
        '--no-skip-existing',
        action='store_true',
        help='Re-process environments even if they have already been evaluated.',
    )
    parser.add_argument(
        '--mlflow',
        nargs=2,
        metavar=('EXPERIMENT_NAME', 'RUN_NAME'),
        help='Enable MLflow tracking with specified experiment and run name',
    )
    parser.add_argument('--filter', nargs='*', help='Filter requirements by tags.')
    parser.add_argument(
        '--no-decomposition',
        action='store_true',
        help='Do not decompose requirements into atomic parts.',
    )
    parser.add_argument(
        '--min-pruning-lines',
        type=int,
        default=1000,
        help='Minimum number of lines to trigger code context pruning.',
    )
    parser.add_argument(
        '--no-test-examples',
        action='store_true',
        help='Do not use test examples from the environment for test generation.',
    )
    parser.add_argument(
        '--individual-decomposition', action='store_true', help=argparse.SUPPRESS
    )
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Expand environment arguments
    expanded_env_req_pairs = expand_environment_args(args.env_req_pairs)

    # Set up MLflow if requested
    mlflow = None
    if args.mlflow:
        mlflow = setup_mlflow(args.mlflow)
        if mlflow:
            # Log parameters - expanded to include all CLI args
            params = {k: v for k, v in vars(args).items() if k != 'mlflow'}
            # Convert lists and other non-string types to strings for MLflow
            for k, v in params.items():
                if isinstance(v, list):
                    params[k] = ','.join(map(str, v))
                elif not isinstance(v, (str, int, float, bool)):
                    params[k] = str(v)
            mlflow.log_params(params)

            # Log information about the environments being processed
            mlflow.log_param(
                'environments',
                ','.join(
                    [Path(pair.split(':')[0]).stem for pair in expanded_env_req_pairs]
                ),
            )
            mlflow.log_param('num_environments', len(expanded_env_req_pairs))

    # Get already processed environments
    processed_envs = get_processed_environments(output_dir)

    all_results = []
    total_generation_cost = 0.0
    total_cost = 0.0
    env_pbar = tqdm(expanded_env_req_pairs, desc='Processing environments')
    for pair in env_pbar:
        if args.max_cost and total_cost >= args.max_cost:
            print(
                f'\nStopping: Cost limit of ${args.max_cost:.2f} reached (current: ${total_cost:.2f})'
            )
            break

        env_path, req_path = parse_env_req_pair(pair)
        env_name = Path(env_path).stem

        # Skip if already processed
        if env_name in processed_envs and not args.no_skip_existing:
            env_pbar.set_description(f'Skipping {env_name}')
            # Load existing result
            with open(output_dir / f'{env_name}_result.json') as f:
                result_dict = json.load(f)
                # Add cost from previous run - account for older format that might not have verification cost
                total_generation_cost += result_dict.get('total_generation_cost', 0)
                total_cost += result_dict.get('total_cost')
            continue

        env_pbar.set_description(f'Processing {env_name}')

        if not os.path.exists(req_path):
            print(
                f'Warning: Requirements file not found at {req_path}, skipping {env_path}...'
            )
            continue

        # Load environment-specific requirements
        env = Environment(env_path)
        try:
            if not args.no_decomposition:
                rm = RequirementsManager(req_path)
                x = {
                    req_id: rm.get_description(req_id) for req_id in rm.requirement_ids
                }
                decomposed = await decompose_requirements(
                    list(x.values()),
                    individual=args.individual_decomposition,
                    k=5,
                    threshold_frequency=0.2,
                )
                decomposed_req_map = {
                    req_id: reqs for req_id, reqs in zip(rm.requirement_ids, decomposed)
                }

                async def decomposer(req):
                    req_template = req.copy()
                    # decomposed_req_descriptions = await decompose_requirement(req['Description'])
                    decomposed_req_descriptions = decomposed_req_map[req['ID']]
                    decomposed_reqs = []
                    for i, decomposed_req_description in enumerate(
                        decomposed_req_descriptions
                    ):
                        decomposed_req = req_template.copy()
                        decomposed_req['ID'] = f'{req["ID"]}.{i + 1}'
                        decomposed_req['Description'] = decomposed_req_description
                        decomposed_reqs.append(decomposed_req)
                    print('Original:', req['Description'])
                    print('Decomposed:', [r['Description'] for r in decomposed_reqs])
                    return decomposed_reqs

                rm = await DecomposingRequirementsManager.from_file(
                    req_path, decomposer=decomposer
                )
            else:
                rm = RequirementsManager(req_path)

            # TODO: Add some information about original requirements in evaluation result in case we decompose requirements here

            if args.filter:
                rm = rm.filter(lambda r: rm.get_function(r) in args.filter)
        except Exception as e:
            import traceback

            traceback.print_exc()
            print(f'Error loading requirements for {env_path}: {e}')
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
            args.retries,
            args.allow_batch_partial,
            args.timeout * 60,  # Convert from minutes to seconds
            args.min_pruning_lines,
            not args.no_test_examples,
        )

        write_env_result(result, output_dir)

        # Log results to MLflow if enabled
        if mlflow:
            log_result_to_mlflow(mlflow, result, env_name)

        all_results.append(result)
        total_generation_cost += result.total_generation_cost
        total_cost += result.total_cost
        print(f'Current generation cost: ${total_generation_cost:.2f}')
        print(f'Current total cost: ${total_cost:.2f}')
        print(f'Execution time: {format_time(result.execution_time)}')
        if result.timed_out:
            print(f'WARNING: Evaluation timed out after {args.timeout} minutes')
        env.cleanup()

    # Log summary metrics to MLflow if enabled
    if mlflow:
        mlflow.log_metric('total_generation_cost', total_generation_cost)
        mlflow.log_metric('total_cost', total_cost)
        mlflow.end_run()

    print('\nEvaluation Summary:')
    print(f'Total generation cost: ${total_generation_cost:.2f}')
    print(f'Total cost: ${total_cost:.2f}')
    for result in all_results:
        print(result)


def format_time(seconds):
    """Format seconds into human-readable time format"""
    if seconds < 60:
        return f'{seconds:.2f} seconds'
    elif seconds < 3600:
        minutes = seconds / 60
        return f'{minutes:.2f} minutes'
    else:
        hours = seconds / 3600
        return f'{hours:.2f} hours'


def cli():
    asyncio.run(main())


if __name__ == '__main__':
    cli()
