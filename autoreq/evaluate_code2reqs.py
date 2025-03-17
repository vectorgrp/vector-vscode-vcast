import json
import os
import argparse
import asyncio
import logging
import csv
import time
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from pydantic import BaseModel, Field, computed_field
from tqdm import tqdm
from tqdm.asyncio import tqdm_asyncio
import traceback
from datetime import datetime

from autoreq.requirement_generation.generation import RequirementsGenerator
from autoreq.requirement_verification.verification import RequirementsVerifier
from autoreq.test_generation.vcast_context_builder import VcastContextBuilder

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
    ground_truth_data: Dict[str, Any]
    verification_results: List[Dict[str, Any]] = Field(default_factory=list)

    # Token usage data
    token_usage: Dict[str, Dict[str, int]]
    total_generation_cost: float  # Renamed from total_cost
    total_verification_cost: float = 0.0
    
    # Optional error information
    generation_error: Optional[str] = None
    
    # Execution information
    execution_time: float
    timed_out: bool = False
    
    @computed_field
    def total_cost(self) -> float:
        """Combined cost of both generation and verification"""
        return self.total_generation_cost + self.total_verification_cost
    
    @computed_field
    def average_score(self) -> float:
        return sum(result['score'] for result in self.verification_results) / len(self.verification_results)
        
    def __str__(self) -> str:
        """Format the evaluation result as a human-readable string"""
        lines = []

        # Header for the environment
        lines.append(f"\n{'=' * 50}")
        lines.append(f"Environment: {self.environment_path}")
        lines.append(f"{'=' * 50}")

        # Verification Information
        lines.append("\nVerification Information:")
        lines.append(f"Average Score: {self.average_score:.4f}")
        
        # Execution Information
        lines.append(f"\nExecution Information:")
        lines.append(f"Execution Time: {format_time(self.execution_time)}")
        if self.timed_out:
            lines.append(f"STATUS: TIMED OUT after {self.execution_time / 60:.2f} minutes")
        
        # Cost information
        lines.append("\nCost Information:")
        lines.append(f"Generation Cost: ${self.total_generation_cost:.4f}")
        lines.append(f"Verification Cost: ${self.total_verification_cost:.4f}")
        lines.append(f"Total Cost: ${self.total_cost:.4f}")
        
        # Error information
        if self.generation_error:
            lines.append("\nGeneration Error:")
            lines.append(self.generation_error)
        
        return "\n".join(lines)

    class Config:
        populate_by_name = True


async def evaluate_environment(
    env_path: str,
    ground_truth_rm: RequirementsManager,
    output_dir: Path,
    extended_reasoning: bool = False,
    combined_related_requirements: bool = False,
    max_generation_time: float = None
) -> EvaluationResult:
    start_time = time.perf_counter()
    env = Environment(env_path)

    env.build()
    
    requirement_generator = RequirementsGenerator(env, extended_reasoning=extended_reasoning, combine_related_requirements=combined_related_requirements)
    requirement_verifier = RequirementsVerifier(env)
    
    # Generate requirements with progress bar
    requirement_sets = {}
    generation_error = None
    pbar = tqdm(total=len(env.testable_functions), desc=f"Generating requirements for {Path(env_path).stem}")

    async def generate_requirements(func_name):
        nonlocal requirement_sets

        result = await requirement_generator.generate(func_name)
        requirement_sets[func_name] = result
        pbar.update(1)

    async def perform_requirement_generation():
        nonlocal requirement_sets, generation_error

        try:
            await asyncio.gather(*[generate_requirements(func['name']) for func in env.testable_functions])
        except Exception as e:
            generation_error = f"Requirement generation failed: {str(e)}\n{''.join(traceback.format_exc())}"
            logging.error(f"Requirement generation failed for {env_path}: {str(e)}")
        finally:
            pbar.close()

    try:
        await asyncio.wait_for(perform_requirement_generation(), timeout=max_generation_time)
    except asyncio.TimeoutError:
        generation_error = f"Requirement generation timed out after {max_generation_time} seconds"
        logging.error(f"Requirement generation timed out for {env_path} after {max_generation_time} seconds")
    except Exception as e:
        generation_error = f"Requirement generation failed: {str(e)}\n{''.join(traceback.format_exc())}"
        logging.error(f"Requirement generation failed for {env_path}: {str(e)}")
    finally:
        pbar.close()

    # Capture generation costs before verification
    generation_token_usage = requirement_generator.llm_client.get_token_usage()
    generation_total_cost = requirement_generator.llm_client.total_cost['total_cost']

    print([[ground_truth_rm.get_description(req_id) for req_id in ground_truth_rm.get_requirements_for_function(func_name)] for func_name in requirement_sets.keys()])
    print(requirement_sets)

    # Create a list of coroutines for verification
    verification_tasks = [
        requirement_verifier.evaluate_requirements(
            func_name,
            requirements,
            mode="gt_similarity",
            ground_truth=[ground_truth_rm.get_description(req_id) for req_id in ground_truth_rm.get_requirements_for_function(func_name)]
        ) for func_name, requirements in requirement_sets.items()
    ]

    # Wait for all verifications to complete while preserving order
    verification_results = await tqdm_asyncio.gather(*verification_tasks, desc=f"Verifying requirements for {Path(env_path).stem}")

    # Capture verification cost
    verification_total_cost = requirement_verifier.llm_client.total_cost['total_cost']

    # Export results
    env_output_dir = output_dir / Path(env_path).stem
    env_output_dir.mkdir(parents=True, exist_ok=True)

    # Export verification results
    verification_results_data = [result.dict() for result in verification_results]
    
    with open(env_output_dir / "verification_results.json", "w") as f:
        json.dump(verification_results_data, f, indent=2)

    token_usage = generation_token_usage

    execution_time = time.perf_counter() - start_time

    env.cleanup()

    # TODO: Write generated reqs to exported csv file

    return EvaluationResult(
        # Basic information
        environment_path=env_path,
        
        # Raw data needed for calculations
        requirements_data={func: reqs for func, reqs in requirement_sets.items()},
        ground_truth_data={func['name']: [ground_truth_rm.get_description(req_id) for req_id in ground_truth_rm.get_requirements_for_function(func['name'])] for func in env.testable_functions},
        verification_results=verification_results_data,

        # Token usage data
        token_usage=token_usage,
        total_generation_cost=generation_total_cost,
        total_verification_cost=verification_total_cost,
        
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

def read_environments_from_file(filepath: str) -> List[str]:
    """Read environment paths from a file, one per line."""
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Environment list file not found: {filepath}")
    
    with open(filepath, 'r') as f:
        # Read all lines and strip whitespace, skipping empty lines and comments
        return [line.strip() for line in f.readlines()
                if line.strip() and not line.strip().startswith('#')]

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
                print(f"Error reading environments from file {filepath}: {e}")
        else:
            expanded_args.append(arg)
    return expanded_args

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
        print("Warning: mlflow is not installed. MLflow tracking is disabled.")
        return None

    # Set longer timeout for artifact uploads
    os.environ["MLFLOW_ARTIFACT_UPLOAD_DOWNLOAD_TIMEOUT"] = "1800"
    

    mlflow_server = os.environ.get("AUTOREQ_MLFLOW_SERVER")
    # Use server from config if available
    if mlflow_server:
        mlflow.set_tracking_uri(mlflow_server)
    
    experiment_name, run_name = mlflow_arg
    run_name += f" {datetime.now().strftime('%Y-%m-%d-%H:%M:%S')}"
    
    # Get or create the experiment
    experiment = mlflow.get_experiment_by_name(experiment_name)
    if not experiment:
        experiment_id = mlflow.create_experiment(experiment_name)
    else:
        experiment_id = experiment.experiment_id
    
    mlflow.set_experiment(experiment_name)
    mlflow.start_run(run_name=run_name)
    mlflow.set_tag("mlflow.runName", run_name)
    
    return mlflow

def log_result_to_mlflow(mlflow, result: EvaluationResult, env_name: str) -> None:
    """Log environment evaluation results to MLflow."""
    if not mlflow:
        return
    
    # Create a metrics dictionary with all available computed metrics
    metrics = {
        # Core metrics
        f"{env_name}/average_score": result.average_score,
        
        # Cost and performance metrics
        f"{env_name}/generation_cost": result.total_generation_cost,
        f"{env_name}/verification_cost": result.total_verification_cost,
        f"{env_name}/total_cost": result.total_cost,
        f"{env_name}/execution_time": result.execution_time,
        f"{env_name}/timed_out": int(result.timed_out),
    }
    
    # Log all metrics
    mlflow.log_metrics(metrics)
    
    # Create environment directory structure for artifacts
    env_artifact_dir = f"environments/{env_name}"

    # Log the full result as a JSON artifact
    mlflow.log_dict(result.model_dump(by_alias=True), f"{env_artifact_dir}/result.json")


async def main():
    parser = argparse.ArgumentParser(description='Evaluate test generation and verification for given environments.')
    parser.add_argument('env_req_pairs', nargs='+', 
                       help='Paths to VectorCAST environment files, optionally followed by :path/to/reqs.csv. '
                            'If no requirements path is specified, looks for reqs.csv in the environment directory. '
                            'You can also use @filepath to include environments listed in a file, one per line.')
    parser.add_argument('output_dir', help='Directory to store evaluation results.')
    parser.add_argument('--extended-reasoning', action='store_true', help='Use extended reasoning.')
    parser.add_argument('--combine-related-requirements', action='store_true',
                        help='Combine related requirements into a single requirement after initial generation.')
    parser.add_argument('--max-cost', type=float, 
                       help='Maximum cost limit in dollar. Processing stops if exceeded.')
    parser.add_argument('--timeout', type=float, default=30.0,
                        help='Maximum time in minutes to wait for environment evaluation (default: 30)')
    parser.add_argument('--no-skip-existing', action='store_true', 
                       help='Re-process environments even if they have already been evaluated.')
    parser.add_argument('--mlflow', nargs=2, metavar=('EXPERIMENT_NAME', 'RUN_NAME'),
                       help='Enable MLflow tracking with specified experiment and run name')
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
            mlflow.log_param("environments", ','.join([Path(pair.split(':')[0]).stem for pair in expanded_env_req_pairs]))
            mlflow.log_param("num_environments", len(expanded_env_req_pairs))

    # Get already processed environments
    processed_envs = get_processed_environments(output_dir)
    
    all_results = []
    total_generation_cost = 0.0
    total_cost = 0.0
    env_pbar = tqdm(expanded_env_req_pairs, desc="Processing environments")
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
                # Add cost from previous run - account for older format that might not have verification cost
                total_generation_cost += result_dict.get('total_generation_cost', 0)
                total_cost += result_dict.get('total_cost')
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
            
        result = await evaluate_environment(
            env_path,
            rm,
            output_dir,
            args.extended_reasoning,
            args.timeout * 60 # Convert from minutes to seconds
        )
        
        write_env_result(result, output_dir)
        
        # Log results to MLflow if enabled
        if mlflow:
            log_result_to_mlflow(mlflow, result, env_name)
        
        all_results.append(result)
        total_generation_cost += result.total_generation_cost
        total_cost += result.total_cost
        print(f"Current generation cost: ${total_generation_cost:.2f}")
        print(f"Current total cost: ${total_cost:.2f}")
        print(f"Execution time: {format_time(result.execution_time)}")
        if result.timed_out:
            print(f"WARNING: Evaluation timed out after {args.timeout} minutes")
        env.cleanup()

    # Log summary metrics to MLflow if enabled
    if mlflow:
        mlflow.log_metric("total_generation_cost", total_generation_cost)
        mlflow.log_metric("total_cost", total_cost)
        mlflow.end_run()

    print("\nEvaluation Summary:")
    print(f"Total generation cost: ${total_generation_cost:.2f}")
    print(f"Total cost: ${total_cost:.2f}")
    for result in all_results:
        print(result)

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