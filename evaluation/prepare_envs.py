#!/usr/bin/env python3
import os
import argparse
import json
import numpy as np
import glob
from pathlib import Path
from tqdm import tqdm
from dotenv import load_dotenv

from autoreq.test_generation.environment import Environment

load_dotenv()

def is_usable_env(env_path):
    """Check if an environment is usable for testing."""
    env = Environment(env_path)
    try:
        env.build()
        result = len(env.units) == 1 and env.testable_functions
        return result
    except Exception as e:
        print(f"Error processing {env_path}: {e}")
        return False
    finally:
        env.cleanup()

def get_atg_coverage(env_path):
    """Get ATG coverage for an environment."""
    env = Environment(env_path)
    try:
        env.build()
        coverage = env.atg_coverage
        return coverage
    except Exception as e:
        print(f"Error getting coverage for {env_path}: {e}")
        return None
    finally:
        env.cleanup()

def read_envs_from_file(file_path):
    """Read environment file paths from a text file."""
    with open(file_path, 'r') as f:
        # Strip whitespace and filter out empty lines
        return [line.strip() for line in f if line.strip()]

def find_usable_environments(env_pattern=None, env_file=None, output_dir=None, get_coverage=False, percentile=90):
    """Find and analyze usable environment files."""
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Find environment files
    if env_pattern:
        env_files = sorted(glob.glob(env_pattern, recursive=True))
        print(f"Found {len(env_files)} environment files using pattern")
    elif env_file:
        env_files = read_envs_from_file(env_file)
        print(f"Read {len(env_files)} environment files from {env_file}")
    else:
        raise ValueError("Either env_pattern or env_file must be provided")
    
    # Filter to usable environments
    print("Checking for usable environments...")
    usable_envs = [env for env in tqdm(env_files) if is_usable_env(env)]
    print(f"Found {len(usable_envs)} usable environments")
    
    # Save usable environments list
    usable_path = os.path.join(output_dir, "usable_envs.txt")
    with open(usable_path, "w") as f:
        f.write("\n".join(usable_envs))
    print(f"Saved usable environments list to {usable_path}")
    
    # If coverage analysis is requested
    if get_coverage:
        print("Analyzing coverage...")
        coverage_data = {}
        for env_file in tqdm(usable_envs):
            coverage = get_atg_coverage(env_file)
            coverage_data[env_file] = coverage
        
        # Save coverage data
        coverage_path = os.path.join(output_dir, "coverage_data.json")
        with open(coverage_path, "w") as f:
            json.dump(coverage_data, f)
        print(f"Saved coverage data to {coverage_path}")
        
        # Filter to large environments based on percentile
        valid_coverages = [v['branches']['total'] for v in coverage_data.values() if v]
        if valid_coverages:
            cutoff = np.percentile(valid_coverages, percentile)
            big_envs = [env for env, coverage in coverage_data.items() 
                      if coverage and coverage['branches']['total'] > cutoff]
            
            big_envs_path = os.path.join(output_dir, f"large_envs_{percentile}p.txt")
            with open(big_envs_path, "w") as f:
                f.write("\n".join(big_envs))
            print(f"Saved {len(big_envs)} large environments (>{percentile}th percentile) to {big_envs_path}")
    
    return usable_envs

def main():
    parser = argparse.ArgumentParser(description='Prepare and analyze environment files for testing')
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument('--env-pattern', help='Glob pattern to find environment files')
    input_group.add_argument('--env-file', help='File containing environment file paths (one per line)')
    parser.add_argument('--output-dir', required=True, help='Output directory for analysis results')
    parser.add_argument('--with-coverage', action='store_true', help='Perform coverage analysis')
    parser.add_argument('--percentile', type=float, default=90, help='Percentile for large environments')
    
    args = parser.parse_args()
    
    find_usable_environments(
        env_pattern=args.env_pattern,
        env_file=args.env_file,
        output_dir=args.output_dir,
        get_coverage=args.with_coverage,
        percentile=args.percentile
    )

if __name__ == "__main__":
    main()
