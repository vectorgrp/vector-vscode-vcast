import glob
from io import BytesIO
import base64
from pathlib import Path
from typing import List, Dict, Any
import argparse

import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt

from autoreq.evaluate_reqs2tests import EvaluationResult
from autoreq.util import format_time


# Default paths when running as main script
DEFAULT_RESULT_FOLDER = 'results/piinnovo'
DEFAULT_REPORT_PATH = 'results/piinnovo/report.html'


def load_results(folder_path: str) -> List[EvaluationResult]:
    """Load all evaluation results from the specified folder"""
    result_paths = glob.glob(f'{folder_path}/*_result.json')
    results = []
    for result_path in result_paths:
        with open(result_path) as f:
            results.append(EvaluationResult.model_validate_json(f.read()))
    return results


def calculate_aggregated_metrics(results: List[EvaluationResult]) -> Dict[str, Any]:
    """Calculate aggregated metrics across all environments"""
    # Filter out results with generation errors for summary metrics
    valid_results = [result for result in results if not result.generation_error]
    error_results = [result for result in results if result.generation_error]

    # Calculate micro-average metrics
    total_verified_tests = sum(result.verified_tests for result in valid_results)
    total_generated_tests = sum(result.generated_tests for result in valid_results)
    total_requirements = sum(result.total_requirements for result in valid_results)

    metrics = {
        # Count of valid and failed environments
        'total_environments': len(results),
        'valid_environments': len(valid_results),
        'failed_environments': len(error_results),
        # Main metrics
        'precision': [result.precision for result in valid_results],
        'recall': [result.recall for result in valid_results],
        'f1_score': [result.f1_score for result in valid_results],
        'total_requirements': total_requirements,
        'generated_tests': total_generated_tests,
        'verified_tests': total_verified_tests,
        # Micro-average metrics (calculated from totals)
        'micro_precision': total_verified_tests / total_generated_tests
        if total_generated_tests > 0
        else 0,
        'micro_recall': total_verified_tests / total_requirements
        if total_requirements > 0
        else 0,
        # Average metrics (macro-averages)
        'avg_precision': np.mean([result.precision for result in valid_results])
        if valid_results
        else 0,
        'avg_recall': np.mean([result.recall for result in valid_results])
        if valid_results
        else 0,
        'avg_f1_score': np.mean([result.f1_score for result in valid_results])
        if valid_results
        else 0,
        'median_precision': np.median([result.precision for result in valid_results])
        if valid_results
        else 0,
        'median_recall': np.median([result.recall for result in valid_results])
        if valid_results
        else 0,
        'median_f1_score': np.median([result.f1_score for result in valid_results])
        if valid_results
        else 0,
        # Requirement Coverage
        'requirement_coverage': [
            result.requirement_coverage
            for result in valid_results
            if result.requirement_coverage_results
        ],
        'avg_requirement_coverage': np.mean(
            [
                result.requirement_coverage
                for result in valid_results
                if result.requirement_coverage_results
            ]
        )
        if any(result.requirement_coverage_results for result in valid_results)
        else 0,
        'median_requirement_coverage': np.median(
            [
                result.requirement_coverage
                for result in valid_results
                if result.requirement_coverage_results
            ]
        )
        if any(result.requirement_coverage_results for result in valid_results)
        else 0,
        # Requirement Coverage (Micro-average)
        'micro_requirement_coverage': np.mean(
            [
                1 if req_result['fully_covered'] else 0
                for result in valid_results
                for req_result in result.requirement_coverage_results
            ]
        ),
        # Coverage metrics
        'statement_coverage': [
            result.coverage.get('statements', {}).get('percentage', 0)
            if isinstance(result.coverage, dict)
            else 0
            for result in results
        ],
        'branch_coverage': [
            result.coverage.get('branches', {}).get('percentage', 0)
            if isinstance(result.coverage, dict)
            else 0
            for result in results
        ],
        # ATG Coverage metrics
        'atg_statement_coverage': [
            result.atg_coverage.get('statements', {}).get('percentage', 0)
            if isinstance(result.atg_coverage, dict)
            else 0
            for result in results
        ],
        'atg_branch_coverage': [
            result.atg_coverage.get('branches', {}).get('percentage', 0)
            if isinstance(result.atg_coverage, dict)
            else 0
            for result in results
        ],
        # Fallback metrics
        'failed_generation_rate': [result.failed_generation_rate for result in results],
        'test_failure_feedback_rate': [
            result.test_failure_feedback_rate for result in results
        ],
        'error_correction_needed_rate': [
            result.error_correction_needed_rate for result in results
        ],
        'partial_test_rate': [result.partial_test_rate for result in results],
        'individual_generation_rate': [
            result.individual_generation_rate for result in results
        ],
        'found_no_allowed_identifiers_rate': [
            result.found_no_allowed_identifiers_rate for result in results
        ],
        'schema_exceeded_size_rate': [
            result.schema_exceeded_size_rate for result in results
        ],
        'no_atg_examples_rate': [result.no_atg_examples_rate for result in results],
        'used_code_context_fallback_rate': [
            result.used_code_context_fallback_rate for result in results
        ],
        'used_atg_identifier_fallback_rate': [
            result.used_atg_identifier_fallback_rate for result in results
        ],
        'exception_rate': [result.exception_rate for result in results],
        # Cost metrics
        'total_generation_cost': sum(
            result.total_generation_cost for result in results
        ),
        'total_verification_cost': sum(
            result.total_verification_cost for result in results
        ),
        'total_cost': sum(result.total_cost for result in results),
        # Time metrics
        'total_execution_time': sum(result.execution_time for result in results),
        'avg_execution_time': np.mean([result.execution_time for result in results]),
    }

    # Calculate micro-average F1 score
    if metrics['micro_precision'] + metrics['micro_recall'] > 0:
        metrics['micro_f1_score'] = (
            2
            * (metrics['micro_precision'] * metrics['micro_recall'])
            / (metrics['micro_precision'] + metrics['micro_recall'])
        )
    else:
        metrics['micro_f1_score'] = 0

    return metrics


def create_histogram(data: List[float], title: str, xlabel: str, figsize=(6, 4)) -> str:
    """Create a histogram and return as base64 encoded image for HTML embedding"""
    plt.figure(figsize=figsize)  # Reduced size from (8, 6) to (6, 4)
    sns.histplot(data, kde=True)
    plt.title(title)
    plt.xlabel(xlabel)
    plt.ylabel('Frequency')
    plt.grid(True, alpha=0.3)

    buf = BytesIO()
    plt.savefig(
        buf, format='png', dpi=90, bbox_inches='tight'
    )  # Reduced DPI from 100 to 90
    plt.close()

    # Convert to base64 for HTML embedding
    img_str = base64.b64encode(buf.getvalue()).decode('utf-8')
    return f'<img src="data:image/png;base64,{img_str}" alt="{title}" />'


def format_metric(
    value: Any, min_decimal_metric=0.01, max_decimal_metric=1, max_metrics=5
) -> str:
    """Format a metric value for display"""
    if isinstance(value, float):
        if value < min_decimal_metric:
            return f'{value:.6f}'
        elif value < max_decimal_metric:
            return f'{value:.4f}'
        else:
            return f'{value:.2f}'
    elif isinstance(value, list):
        return f'[{", ".join([format_metric(v) for v in value[:max_metrics]])}{"..." if len(value) > max_metrics else ""}]'
    else:
        return str(value)


def format_percentage(value: float) -> str:
    """Format a value as a percentage"""
    return f'{value * 100:.2f}%'


def create_html_report(results: List[EvaluationResult], metrics: Dict[str, Any]) -> str:
    """Create the complete HTML report"""
    # Define HTML templates
    html_head = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Test Generation Evaluation Report</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                margin: 0;
                padding: 20px;
                color: #333;
                max-width: 1200px;
                margin: 0 auto;
            }
            h1, h2, h3, h4 {
                color: #2c3e50;
            }
            h1 {
                border-bottom: 2px solid #3498db;
                padding-bottom: 10px;
            }
            h2 {
                border-bottom: 1px solid #bdc3c7;
                padding-bottom: 5px;
            }
            .report-section {
                margin-bottom: 30px;
                padding: 15px;
                background-color: #f9f9f9;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .collapsible {
                background-color: #e9e9e9;
                color: #444;
                cursor: pointer;
                padding: 18px;
                width: 100%;
                border: none;
                text-align: left;
                outline: none;
                font-size: 16px;
                border-radius: 4px;
                margin-bottom: 1px;
            }
            .active, .collapsible:hover {
                background-color: #ccc;
            }
            .content {
                padding: 0 18px;
                max-height: 0;
                overflow: hidden;
                transition: max-height 0.5s ease-out;
                background-color: #f9f9f9;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 15px 0;
            }
            th, td {
                padding: 10px;
                border: 1px solid #ddd;
                text-align: left;
            }
            th {
                background-color: #f2f2f2;
            }
            tr:nth-child(even) {
                background-color: #f9f9f9;
            }
            .metric-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                gap: 15px;
                margin: 15px 0;
            }
            .metric-card {
                background-color: white;
                border-radius: 5px;
                padding: 10px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.12);
            }
            .metric-name {
                font-weight: bold;
                color: #2c3e50;
            }
            .metric-value {
                font-size: 1.2em;
                margin: 5px 0;
            }
            .histogram {
                margin: 20px 0;
                text-align: center;
                max-width: 100%;
                overflow: hidden;
            }
            .histogram img {
                max-width: 95%;
                height: auto;
            }
            .summary-cards {
                display: flex;
                flex-wrap: wrap;
                gap: 15px;
                margin-bottom: 20px;
            }
            .summary-card {
                flex: 1;
                min-width: 200px;
                background-color: #fff;
                border-left: 5px solid #3498db;
                box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                padding: 15px;
                border-radius: 0 5px 5px 0;
            }
            .summary-card h3 {
                margin-top: 0;
                font-size: 0.9em;
                color: #7f8c8d;
            }
            .summary-card .value {
                font-size: 1.8em;
                font-weight: bold;
                color: #2c3e50;
            }
            .info {
                color: #3498db;
            }
            .warning {
                color: #e67e22;
            }
            .error {
                color: #e74c3c;
            }
            .success {
                color: #2ecc71;
            }
            .coverage-bars {
                margin: 20px 0;
                background: #f5f5f5;
                padding: 15px;
                border-radius: 5px;
            }
            .coverage-bar {
                margin-bottom: 15px;
            }
            .coverage-bar .label {
                display: flex;
                justify-content: space-between;
                margin-bottom: 5px;
            }
            .bar-container {
                height: 20px;
                background-color: #e1e1e1;
                border-radius: 10px;
                overflow: hidden;
                position: relative;
            }
            .bar-fill {
                height: 100%;
                background-color: #3498db;
                border-radius: 10px;
                position: absolute;
                top: 0;
                left: 0;
            }
            .atg-bar-fill {
                height: 100%;
                background-color: #e74c3c;
                border-radius: 10px;
                position: absolute;
                top: 0;
                left: 0;
                opacity: 0.7;
            }
            .coverage-legend {
                display: flex;
                gap: 20px;
                margin: 10px 0;
                padding: 5px;
            }
            .legend-item {
                display: flex;
                align-items: center;
                gap: 5px;
            }
            .legend-color {
                width: 15px;
                height: 15px;
                border-radius: 3px;
            }
            .histogram-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
                gap: 20px;
            }
            .histogram-container {
                border: 1px solid #ddd;
                border-radius: 8px;
                overflow: hidden;
            }
            .histogram-header {
                background-color: #f2f2f2;
                padding: 10px;
                font-weight: bold;
                border-bottom: 1px solid #ddd;
            }
            .nested-section {
                padding-top: 18px;
                overflow: hidden;
            }
            /* Set very large max-heights for top level contents to prevent overflow issues */
            .top-level-content {
                max-height: none !important;
                height: auto !important;
                overflow: visible !important;
            }
            .metric-section {
                margin-bottom: 1.5rem;
            }
            .metric-heading {
                font-size: 1.1em;
                margin-bottom: 0.5em;
                color: #34495e;
            }
        </style>
    </head>
    <body>
        <h1>Test Generation Evaluation Report</h1>
    """

    # Create summary section
    summary_section = f"""
        <div class="report-section">
            <h2>Summary</h2>
            <p>Processed {metrics['total_environments']} environments with {metrics['failed_environments']} failed environments. 
               Summary metrics below are calculated from {metrics['valid_environments']} successful environments with a total of {metrics['total_requirements']} requirements.</p>

            <div class="metric-section">
                <div class="summary-cards">
                     <div class="summary-card">
                        <h3>Requirement Coverage (Macro Avg.)</h3>
                        <div class="value">{format_percentage(metrics['avg_requirement_coverage'])}</div>
                    </div>
                     <div class="summary-card">
                        <h3>Requirement Coverage (Micro Avg.)</h3>
                        <div class="value">{format_percentage(metrics['micro_requirement_coverage'])}</div>
                    </div>
                </div>
            </div>
            
            <div class="summary-cards">
                <div class="summary-card">
                    <h3>Requirements</h3>
                    <div class="value">{metrics['total_requirements']}</div>
                </div>
                <div class="summary-card">
                    <h3>Generated Tests</h3>
                    <div class="value">{metrics['generated_tests']}</div>
                </div>
                <div class="summary-card">
                    <h3>Verified Tests</h3>
                    <div class="value">{metrics['verified_tests']}</div>
                </div>
            </div>

            <div class="metric-section">
                <div class="summary-cards">
                    <div class="summary-card">
                        <h3>Precision (Macro Avg.)</h3>
                        <div class="value">{format_percentage(metrics['avg_precision'])}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Recall (Macro Avg.)</h3>
                        <div class="value">{format_percentage(metrics['avg_recall'])}</div>
                    </div>
                    <div class="summary-card">
                        <h3>F1 Score (Macro Avg.)</h3>
                        <div class="value">{format_percentage(metrics['avg_f1_score'])}</div>
                    </div>
                </div>
            </div>
            
            <div class="metric-section">
                <div class="summary-cards">
                    <div class="summary-card">
                        <h3>Precision (Micro Avg.)</h3>
                        <div class="value">{format_percentage(metrics['micro_precision'])}</div>
                    </div>
                    <div class="summary-card">
                        <h3>Recall (Micro Avg.)</h3>
                        <div class="value">{format_percentage(metrics['micro_recall'])}</div>
                    </div>
                    <div class="summary-card">
                        <h3>F1 Score (Micro Avg.)</h3>
                        <div class="value">{format_percentage(metrics['micro_f1_score'])}</div>
                    </div>
                </div>
            </div>
            
            <div class="summary-cards">
                <div class="summary-card">
                    <h3>Total Generation Cost</h3>
                    <div class="value">${format_metric(metrics['total_generation_cost'])}</div>
                </div>
                <div class="summary-card">
                    <h3>Total Verification Cost</h3>
                    <div class="value">${format_metric(metrics['total_verification_cost'])}</div>
                </div>
                <div class="summary-card">
                    <h3>Total Cost</h3>
                    <div class="value">${format_metric(metrics['total_cost'])}</div>
                </div>
            </div>
            
            <div class="summary-cards">
                <div class="summary-card">
                    <h3>Total Execution Time</h3>
                    <div class="value">{format_time(metrics['total_execution_time'])}</div>
                </div>
                <div class="summary-card">
                    <h3>Avg Execution Time</h3>
                    <div class="value">{format_time(metrics['avg_execution_time'])}</div>
                </div>
                <div class="summary-card">
                    <h3>Failed Environments</h3>
                    <div class="value">{metrics['failed_environments']}</div>
                </div>
            </div>

        </div>
    """

    # Create main metrics section with histograms
    main_metrics_section = """
        <div class="report-section">
            <button class="collapsible">Main Metrics</button>
            <div class="content">
                <h3>Main Performance Metrics</h3>
    """

    # Add histograms for precision, recall, and F1 score
    main_metrics_section += """
                <div class="histogram">
                    <h4>Precision Distribution</h4>
    """
    main_metrics_section += create_histogram(
        metrics['precision'], 'Precision Distribution', 'Precision'
    )
    main_metrics_section += """
                </div>
                
                <div class="histogram">
                    <h4>Recall Distribution</h4>
    """
    main_metrics_section += create_histogram(
        metrics['recall'], 'Recall Distribution', 'Recall'
    )
    main_metrics_section += """
                </div>
                
                <div class="histogram">
                    <h4>F1 Score Distribution</h4>
    """
    main_metrics_section += create_histogram(
        metrics['f1_score'], 'F1 Score Distribution', 'F1 Score'
    )
    main_metrics_section += """
                </div>

                <div class="histogram">
                    <h4>Requirement Coverage Distribution</h4>
    """
    main_metrics_section += create_histogram(
        metrics['requirement_coverage'],
        'Requirement Coverage Distribution',
        'Requirement Coverage',
    )
    main_metrics_section += """
                </div>
            </div>
        </div>
    """

    # Create coverage metrics section with ATG comparison
    coverage_section = """
        <div class="report-section">
            <button class="collapsible">Coverage Metrics</button>
            <div class="content">
                <h3>Code Coverage Comparison</h3>
                
                <div class="coverage-legend">
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #3498db;"></div>
                        <span>Our Tests</span>
                    </div>
                    <div class="legend-item">
                        <div class="legend-color" style="background-color: #e74c3c;"></div>
                        <span>ATG Tests</span>
                    </div>
                </div>
                
                <div class="coverage-bars">
                    <div class="coverage-bar">
                        <div class="label">
                            <span>Statement Coverage</span>
                            <span>Our: {:.2%} | ATG: {:.2%}</span>
                        </div>
                        <div class="bar-container">
                            <div class="bar-fill" style="width: {:.2%};"></div>
                            <div class="atg-bar-fill" style="width: {:.2%};"></div>
                        </div>
                    </div>
                    
                    <div class="coverage-bar">
                        <div class="label">
                            <span>Branch Coverage</span>
                            <span>Our: {:.2%} | ATG: {:.2%}</span>
                        </div>
                        <div class="bar-container">
                            <div class="bar-fill" style="width: {:.2%};"></div>
                            <div class="atg-bar-fill" style="width: {:.2%};"></div>
                        </div>
                    </div>
                </div>
    """.format(
        np.mean([c for c in metrics['statement_coverage'] if c is not None]),
        np.mean([c for c in metrics['atg_statement_coverage'] if c is not None]),
        np.mean([c for c in metrics['statement_coverage'] if c is not None]),
        np.mean([c for c in metrics['atg_statement_coverage'] if c is not None]),
        np.mean([c for c in metrics['branch_coverage'] if c is not None]),
        np.mean([c for c in metrics['atg_branch_coverage'] if c is not None]),
        np.mean([c for c in metrics['branch_coverage'] if c is not None]),
        np.mean([c for c in metrics['atg_branch_coverage'] if c is not None]),
    )

    # Add histograms for coverage metrics
    coverage_section += """
                <div class="histogram-grid">
                    <div class="histogram-container">
                        <div class="histogram-header">Statement Coverage Distribution</div>
    """
    coverage_section += create_histogram(
        [c for c in metrics['statement_coverage'] if c is not None],
        'Statement Coverage Distribution',
        'Statement Coverage',
    )
    coverage_section += """
                    </div>
                    
                    <div class="histogram-container">
                        <div class="histogram-header">ATG Statement Coverage Distribution</div>
    """
    coverage_section += create_histogram(
        [c for c in metrics['atg_statement_coverage'] if c is not None],
        'ATG Statement Coverage Distribution',
        'Statement Coverage',
    )
    coverage_section += """
                    </div>
                    
                    <div class="histogram-container">
                        <div class="histogram-header">Branch Coverage Distribution</div>
    """
    coverage_section += create_histogram(
        [c for c in metrics['branch_coverage'] if c is not None],
        'Branch Coverage Distribution',
        'Branch Coverage',
    )
    coverage_section += """
                    </div>
                    
                    <div class="histogram-container">
                        <div class="histogram-header">ATG Branch Coverage Distribution</div>
    """
    coverage_section += create_histogram(
        [c for c in metrics['atg_branch_coverage'] if c is not None],
        'ATG Branch Coverage Distribution',
        'Branch Coverage',
    )
    coverage_section += """
                    </div>
                </div>
            </div>
        </div>
    """

    # Create fallback metrics section with histograms for all metrics
    fallback_section = """
        <div class="report-section">
            <button class="collapsible">Fallback Metrics</button>
            <div class="content">
                <h3>Fallback Usage Metrics (Macro Avg.)</h3>
                
                <div class="metric-grid">
    """

    fallback_metrics = [
        ('Failed Generation Rate', metrics['failed_generation_rate']),
        ('Test Failure Feedback Rate', metrics['test_failure_feedback_rate']),
        ('Error Correction Needed Rate', metrics['error_correction_needed_rate']),
        ('Partial Test Rate', metrics['partial_test_rate']),
        ('Individual Generation Rate', metrics['individual_generation_rate']),
        (
            'Found No Allowed Identifiers Rate',
            metrics['found_no_allowed_identifiers_rate'],
        ),
        ('Schema Exceeded Size Rate', metrics['schema_exceeded_size_rate']),
        ('No ATG Examples Rate', metrics['no_atg_examples_rate']),
        ('Used Code Context Fallback Rate', metrics['used_code_context_fallback_rate']),
        (
            'Used ATG Identifier Fallback Rate',
            metrics['used_atg_identifier_fallback_rate'],
        ),
        ('Exception Rate', metrics['exception_rate']),
    ]

    for name, values in fallback_metrics:
        avg_value = np.mean(values)
        fallback_section += f"""
                    <div class="metric-card">
                        <div class="metric-name">{name}</div>
                        <div class="metric-value">{format_percentage(avg_value)}</div>
                    </div>
        """

    fallback_section += """
                </div>
                <h3>Fallback Metrics Distributions</h3>
                <div class="histogram-grid">
    """

    # Add histograms for ALL fallback metrics
    for name, values in fallback_metrics:
        fallback_section += f"""
                    <div class="histogram-container">
                        <div class="histogram-header">{name} Distribution</div>
        """
        fallback_section += create_histogram(values, f'{name} Distribution', name)
        fallback_section += """
                    </div>
        """

    fallback_section += """
                </div>
            </div>
        </div>
    """

    # Create individual results section with improved collapsing behavior
    individual_results_section = """
        <div class="report-section">
            <button class="collapsible">Individual Environment Results</button>
            <div class="content">
    """

    # Add each individual environment's results
    for result in results:
        env_name = Path(result.environment_path).stem
        individual_results_section += f"""
                <button class="collapsible">{env_name}</button>
                <div class="content">
                    <h4>Environment: {result.environment_path}</h4>
                    
                    <div class="summary-cards">
                        <div class="summary-card">
                            <h3>Requirements</h3>
                            <div class="value">{result.total_requirements}</div>
                        </div>
                        <div class="summary-card">
                            <h3>Generated Tests</h3>
                            <div class="value">{result.generated_tests}</div>
                        </div>
                        <div class="summary-card">
                            <h3>Verified Tests</h3>
                            <div class="value">{result.verified_tests}</div>
                        </div>
                    </div>
                    
                    <div class="summary-cards">
                        <div class="summary-card">
                            <h3>Precision</h3>
                            <div class="value">{format_percentage(result.precision)}</div>
                        </div>
                        <div class="summary-card">
                            <h3>Recall</h3>
                            <div class="value">{format_percentage(result.recall)}</div>
                        </div>
                        <div class="summary-card">
                            <h3>F1 Score</h3>
                            <div class="value">{format_percentage(result.f1_score)}</div>
                        </div>
                    </div>
                    
                    <div class="summary-cards">
                        <div class="summary-card">
                            <h3>Requirement Coverage</h3>
                            <div class="value">{format_percentage(result.requirement_coverage)}</div>
                        </div>
                    </div>

                    <h4>Coverage Information</h4>
        """

        # Add coverage information with ATG comparison if available
        stmt_cov = 0
        branch_cov = 0
        atg_stmt_cov = 0
        atg_branch_cov = 0

        if isinstance(result.coverage, dict) and 'statements' in result.coverage:
            stmt_cov = result.coverage['statements'].get('percentage', 0)
            branch_cov = result.coverage.get('branches', {}).get('percentage', 0)

        if (
            isinstance(result.atg_coverage, dict)
            and 'statements' in result.atg_coverage
        ):
            atg_stmt_cov = result.atg_coverage['statements'].get('percentage', 0)
            atg_branch_cov = result.atg_coverage.get('branches', {}).get(
                'percentage', 0
            )

        individual_results_section += f"""
                    <div class="coverage-legend">
                        <div class="legend-item">
                            <div class="legend-color" style="background-color: #3498db;"></div>
                            <span>Our Tests</span>
                        </div>
                        <div class="legend-item">
                            <div class="legend-color" style="background-color: #e74c3c;"></div>
                            <span>ATG Tests</span>
                        </div>
                    </div>
                    
                    <div class="coverage-bars">
                        <div class="coverage-bar">
                            <div class="label">
                                <span>Statement Coverage</span>
                                <span>Our: {stmt_cov:.2%} | ATG: {atg_stmt_cov:.2%}</span>
                            </div>
                            <div class="bar-container">
                                <div class="bar-fill" style="width: {stmt_cov:.2%};"></div>
                                <div class="atg-bar-fill" style="width: {atg_stmt_cov:.2%};"></div>
                            </div>
                        </div>
                        
                        <div class="coverage-bar">
                            <div class="label">
                                <span>Branch Coverage</span>
                                <span>Our: {branch_cov:.2%} | ATG: {atg_branch_cov:.2%}</span>
                            </div>
                            <div class="bar-container">
                                <div class="bar-fill" style="width: {branch_cov:.2%};"></div>
                                <div class="atg-bar-fill" style="width: {atg_branch_cov:.2%};"></div>
                            </div>
                        </div>
                    </div>
        """

        # Add fallback metrics
        individual_results_section += """
                    <h4>Fallback Metrics</h4>
                    <table>
                        <tr>
                            <th>Metric</th>
                            <th>Value</th>
                        </tr>
        """

        fallback_items = [
            ('Failed Generation Rate', result.failed_generation_rate),
            ('Test Failure Feedback Rate', result.test_failure_feedback_rate),
            ('Error Correction Needed Rate', result.error_correction_needed_rate),
            ('Partial Test Rate', result.partial_test_rate),
            ('Individual Generation Rate', result.individual_generation_rate),
            (
                'Found No Allowed Identifiers Rate',
                result.found_no_allowed_identifiers_rate,
            ),
            ('Schema Exceeded Size Rate', result.schema_exceeded_size_rate),
            ('No ATG Examples Rate', result.no_atg_examples_rate),
            ('Used Code Context Fallback Rate', result.used_code_context_fallback_rate),
            (
                'Used ATG Identifier Fallback Rate',
                result.used_atg_identifier_fallback_rate,
            ),
            ('Exception Rate', result.exception_rate),
        ]

        for name, value in fallback_items:
            individual_results_section += f"""
                        <tr>
                            <td>{name}</td>
                            <td>{format_percentage(value)}</td>
                        </tr>
            """

        individual_results_section += """
                    </table>
                    
                    <h4>Cost Information</h4>
                    <table>
                        <tr>
                            <th>Metric</th>
                            <th>Value</th>
                        </tr>
                        <tr>
                            <td>Generation Cost</td>
                            <td>${:.4f}</td>
                        </tr>
                        <tr>
                            <td>Verification Cost</td>
                            <td>${:.4f}</td>
                        </tr>
                        <tr>
                            <td>Total Cost</td>
                            <td>${:.4f}</td>
                        </tr>
                        <tr>
                            <td>Execution Time</td>
                            <td>{}</td>
                        </tr>
                    </table>
        """.format(
            result.total_generation_cost,
            result.total_verification_cost,
            result.total_cost,
            format_time(result.execution_time),
        )

        # Add error information if available
        if result.generation_error:
            individual_results_section += f"""
                    <h4>Error Information</h4>
                    <div style="background-color: #ffeeee; padding: 10px; border-radius: 5px;">
                        <pre>{result.generation_error}</pre>
                    </div>
            """

        individual_results_section += """
                </div>
        """

    individual_results_section += """
            </div>
        </div>
    """

    # Updated JavaScript for better handling of collapsible sections
    js_section = """
        <script>
            document.addEventListener('DOMContentLoaded', function() {
                var coll = document.getElementsByClassName("collapsible");
                
                // Helper function to update parent heights
                function updateParentHeights(element) {
                    let parent = element;
                    while (parent) {
                        let content = parent.nextElementSibling;
                        if (content && content.classList.contains("content")) {
                            if (content.style.maxHeight) {
                                content.style.maxHeight = content.scrollHeight + "px";
                            }
                        }
                        parent = parent.parentElement;
                        if (parent && !parent.classList.contains("content")) {
                            break;
                        }
                    }
                }
                
                // Initialize collapsible sections
                for (var i = 0; i < coll.length; i++) {
                    coll[i].addEventListener("click", function() {
                        this.classList.toggle("active");
                        var content = this.nextElementSibling;
                        
                        // Toggle current section
                        if (content.style.maxHeight) {
                            content.style.maxHeight = null;
                        } else {
                            content.style.maxHeight = content.scrollHeight + "px";
                            
                            // Update parent heights for nested sections
                            setTimeout(() => {
                                updateParentHeights(this);
                            }, 10);
                        }
                    });
                }
                
                // Mark top-level contents for special handling
                var reportSections = document.querySelectorAll('.report-section > .content');
                for (var i = 0; i < reportSections.length; i++) {
                    reportSections[i].classList.add('top-level-content');
                }
                
                // Open the first level of collapsibles by default
                var topLevelColl = document.querySelectorAll('.report-section > .collapsible');
                for (var i = 0; i < topLevelColl.length; i++) {
                    topLevelColl[i].click();
                }
            });
        </script>
    """

    html_footer = """
    </body>
    </html>
    """

    # Combine all sections
    return (
        html_head
        + summary_section
        + main_metrics_section
        + coverage_section
        + fallback_section
        + individual_results_section
        + js_section
        + html_footer
    )


def create_report(result_folder: str, report_path: str):
    """Generate a report from results in the specified folder and save it to the report path"""
    # Create output directory if it doesn't exist
    Path(report_path).parent.mkdir(parents=True, exist_ok=True)

    # Load results
    results = load_results(result_folder)
    if not results:
        print(f'No result files found in {result_folder}')
        return

    print(f'Loaded {len(results)} evaluation results for {report_path}')

    # Calculate aggregated metrics
    metrics = calculate_aggregated_metrics(results)

    # Create HTML report
    html_report = create_html_report(results, metrics)

    # Write report to file
    with open(report_path, 'w') as f:
        f.write(html_report)

    print(f'Report generated at {report_path}')


def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(
        description='Generate HTML report from evaluation results'
    )
    parser.add_argument(
        '--input',
        type=str,
        default=DEFAULT_RESULT_FOLDER,
        help=f'Folder containing evaluation result files (default: {DEFAULT_RESULT_FOLDER})',
    )
    parser.add_argument(
        '--output',
        type=str,
        default=DEFAULT_REPORT_PATH,
        help=f'Path where the HTML report will be saved (default: {DEFAULT_REPORT_PATH})',
    )
    args = parser.parse_args()

    # Generate report
    create_report(args.input, args.output)


if __name__ == '__main__':
    main()
