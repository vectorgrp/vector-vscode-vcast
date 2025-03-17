import glob
import json
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt
from io import BytesIO
import base64
from autoreq.evaluate_reqs2tests import EvaluationResult
from pathlib import Path
import numpy as np
from typing import List, Dict, Any, Tuple
from pathlib import Path
import shutil
import os
from evaluation.create_report import create_report

RESULT_FOLDER = "results/piinnovo"
DERIVED_RESULTS_FOLDER = "results/piinnovo_derived"

def load_results(folder_path: str) -> List[EvaluationResult]:
    """Load all evaluation results from the specified folder"""
    result_paths = glob.glob(f"{folder_path}/*_result.json")
    results = []
    for result_path in result_paths:
        with open(result_path) as f:
            results.append(EvaluationResult.model_validate_json(f.read()))
    return results

# big vs small
# fallback vs no fallback
# large atg coverage disparity

results = load_results(RESULT_FOLDER)

def is_big(result: EvaluationResult) -> bool:
    """Determine if the environment is big"""
    return result.atg_coverage['branches']['total'] > 100

big_results = [result for result in results if is_big(result)]
small_results = [result for result in results if not is_big(result)]

def uses_fallback(result: EvaluationResult) -> bool:
    """Determine if the environment uses any fallback mechanism"""
    if result.found_no_allowed_identifiers_rate > 0:
        return True
    
    if result.schema_exceeded_size_rate > 0:
        return True
    
    if result.no_atg_examples_rate > 0:
        return True
    
    if result.used_code_context_fallback_rate > 0:
        return True
    
    if result.used_atg_identifier_fallback_rate > 0:
        return True
    
    return False

uses_fallback_results = [result for result in results if uses_fallback(result)]
no_fallback_results = [result for result in results if not uses_fallback(result)]

def has_large_disparity(result: EvaluationResult) -> bool:
    """Determine if the environment has a large disparity in ATG coverage and our coverage"""
    return (result.atg_coverage['branches']['percentage'] - result.coverage['branches']['percentage']) > 0.5

large_disparity_results = [result for result in results if has_large_disparity(result)]

# Get environments with bottom 20% quantile of f1_scores
def get_bottom_f1_score_quantile(results: List[EvaluationResult], quantile: float = 0.2) -> List[EvaluationResult]:
    """Identify environments with f1_scores in the bottom quantile"""
    # Extract f1_scores
    f1_scores = [result.f1_score for result in results]
    # Calculate threshold for bottom quantile
    threshold = np.quantile(f1_scores, quantile)
    # Filter results
    return [result for result in results if result.f1_score <= threshold]

low_f1_results = get_bottom_f1_score_quantile(results)

# Now create derived results jsons so we can generate reports for each
Path(DERIVED_RESULTS_FOLDER).mkdir(parents=True, exist_ok=True)

# First, small vs big

def copy_results_to_derived_folder(result_list: List[EvaluationResult], subfolder: str):
    """Copy results to a subfolder in the derived results folder"""
    # Create subfolder if it doesn't exist
    target_folder = os.path.join(DERIVED_RESULTS_FOLDER, subfolder)
    Path(target_folder).mkdir(parents=True, exist_ok=True)
    
    # Get all result files in the source folder
    all_result_files = glob.glob(f"{RESULT_FOLDER}/*_result.json")
    
    # For each result in our list, find the matching file and copy it
    for result in result_list:
        found = False
        for file_path in all_result_files:
            # Load the file to check if it's the right one
            with open(file_path) as f:
                file_content = f.read()
                # Check if the content matches our result
                if EvaluationResult.model_validate_json(file_content) == result:
                    # Copy to target folder with same name
                    target_file = os.path.join(target_folder, os.path.basename(file_path))
                    shutil.copy2(file_path, target_file)
                    print(f"Copied {file_path} to {target_file}")
                    found = True
                    break
        
        if not found:
            print(f"Warning: Source file for a result not found.")
    
    # Return the created folder path
    return target_folder

# Dictionary to hold category names and their result lists
categories = {
    "big": big_results,
    "small": small_results,
    "uses_fallback": uses_fallback_results,
    "no_fallback": no_fallback_results,
    "large_disparity": large_disparity_results,
    "bottom_20_f1": low_f1_results
}

# Create derived folders and generate reports for each category
for category_name, result_list in categories.items():
    # Copy files to derived folder
    target_folder = copy_results_to_derived_folder(result_list, category_name)
    
    # Generate report for this category
    report_path = os.path.join(target_folder, f"report_{category_name}.html")
    create_report(target_folder, report_path)
    print(f"Generated report for {category_name} category at {report_path}")

# Also generate a report for all results in the original folder
create_report(RESULT_FOLDER, os.path.join(RESULT_FOLDER, "report.html"))

print(f"Results copied to subfolders in {DERIVED_RESULTS_FOLDER}")
print("Generated reports for all categories")
