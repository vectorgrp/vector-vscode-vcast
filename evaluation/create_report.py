import glob
import json
import base64
import argparse

from io import BytesIO
from pathlib import Path
from typing import List, Dict, Any

import numpy as np
import seaborn as sns
from bs4 import BeautifulSoup
import matplotlib.pyplot as plt
from markdownify import markdownify as md

from autoreq.evaluate_reqs2tests import EvaluationResult
from autoreq.util import format_time


def load_results(folder_path: str) -> List[EvaluationResult]:
    """Load all evaluation results from the specified folder"""
    result_paths = glob.glob(f'{folder_path}/*_result.json')
    results = []
    for result_path in result_paths:
        with open(result_path) as f:
            results.append(EvaluationResult.model_validate_json(f.read()))
    return results


def load_test_cases(folder_path: str) -> Dict[str, Dict]:
    """Load all test cases from the specified folder"""
    test_cases = {}
    for test_case_path in Path(folder_path).rglob('test_cases.json'):
        env = test_case_path.parent.name
        with open(test_case_path, 'r') as f:
            test_cases[env] = {tc['requirement_id']: tc for tc in json.load(f)}
    return test_cases


def calculate_aggregated_metrics(results: List[EvaluationResult]) -> Dict[str, Dict]:
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


def _extract_uncovered_lines(result: EvaluationResult) -> List[Dict[str, str]]:
    tu_lines = result.tu_content.splitlines()
    all_funcs = result.functions_info

    ret = []
    for rcr in result.requirement_coverage_results:
        req_id = rcr['requirement_id']
        func_info = all_funcs[rcr['function']]
        start_line = func_info['start_line']
        for line_n in rcr['required_lines']:
            source_line = tu_lines[start_line + line_n].strip()
            ret.append(
                {
                    'line_number': start_line + line_n + 1,
                    'requirement_id': req_id,
                    'source_line': source_line,
                    'requirement_text': result.requirements_data[req_id]['title'],
                }
            )

    return ret


def create_html_report(
    results: List[EvaluationResult], metrics: Dict[str, Any], test_cases: Dict[str, Any]
) -> BeautifulSoup:
    soup = BeautifulSoup('', 'html.parser')

    # <html lang="en">
    html_tag = soup.new_tag('html', lang='en')
    soup.append(html_tag)

    # <head> section
    head_tag = soup.new_tag('head')
    html_tag.append(head_tag)

    # <meta charset="UTF-8">
    meta_charset = soup.new_tag('meta', charset='UTF-8')
    head_tag.append(meta_charset)

    # <meta name="viewport" content="width=device-width, initial-scale=1.0">
    meta_viewport = soup.new_tag(
        'meta',
        attrs={'name': 'viewport', 'content': 'width=device-width, initial-scale=1.0'},
    )
    head_tag.append(meta_viewport)

    # <title>Test Generation Evaluation Report</title>
    title_tag = soup.new_tag('title')
    title_tag.string = 'Test Generation Evaluation Report'
    head_tag.append(title_tag)

    # <style> ... </style> (unchanged CSS)
    style_tag = soup.new_tag('style')
    style_content = """
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
        """
    style_tag.string = style_content
    head_tag.append(style_tag)

    # <body>
    body_tag = soup.new_tag('body')
    html_tag.append(body_tag)

    # <h1>Test Generation Evaluation Report</h1>
    h1 = soup.new_tag('h1')
    h1.string = 'Test Generation Evaluation Report'
    body_tag.append(h1)

    # Create summary section
    summary_section = soup.new_tag('div', **{'class': 'report-section'})
    body_tag.append(summary_section)

    h2_summary = soup.new_tag('h2')
    h2_summary.string = 'Summary'
    summary_section.append(h2_summary)

    p_summary = soup.new_tag('p')
    p_summary.string = (
        f'Processed {metrics["total_environments"]} environments with {metrics["failed_environments"]} failed environments. '
        f'Summary metrics below are calculated from {metrics["valid_environments"]} successful environments with a total of {metrics["total_requirements"]} requirements.'
    )
    summary_section.append(p_summary)

    metric_section1 = soup.new_tag('div', **{'class': 'metric-section'})
    summary_section.append(metric_section1)

    summary_cards1 = soup.new_tag('div', **{'class': 'summary-cards'})
    metric_section1.append(summary_cards1)

    # Requirement Coverage (Macro Avg.)
    card_req_macro = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards1.append(card_req_macro)
    h3_req_macro = soup.new_tag('h3')
    h3_req_macro.string = 'Requirement Coverage (Macro Avg.)'
    card_req_macro.append(h3_req_macro)
    div_value_req_macro = soup.new_tag('div', **{'class': 'value'})
    div_value_req_macro.string = format_percentage(metrics['avg_requirement_coverage'])
    card_req_macro.append(div_value_req_macro)

    # Requirement Coverage (Micro Avg.)
    card_req_micro = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards1.append(card_req_micro)
    h3_req_micro = soup.new_tag('h3')
    h3_req_micro.string = 'Requirement Coverage (Micro Avg.)'
    card_req_micro.append(h3_req_micro)
    div_value_req_micro = soup.new_tag('div', **{'class': 'value'})
    div_value_req_micro.string = format_percentage(
        metrics['micro_requirement_coverage']
    )
    card_req_micro.append(div_value_req_micro)

    # Second row of summary cards: Requirements, Generated Tests, Verified Tests
    summary_cards2 = soup.new_tag('div', **{'class': 'summary-cards'})
    summary_section.append(summary_cards2)

    card_requirements = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards2.append(card_requirements)
    h3_requirements = soup.new_tag('h3')
    h3_requirements.string = 'Requirements'
    card_requirements.append(h3_requirements)
    div_value_requirements = soup.new_tag('div', **{'class': 'value'})
    div_value_requirements.string = str(metrics['total_requirements'])
    card_requirements.append(div_value_requirements)

    card_generated = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards2.append(card_generated)
    h3_generated = soup.new_tag('h3')
    h3_generated.string = 'Generated Tests'
    card_generated.append(h3_generated)
    div_value_generated = soup.new_tag('div', **{'class': 'value'})
    div_value_generated.string = str(metrics['generated_tests'])
    card_generated.append(div_value_generated)

    card_verified = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards2.append(card_verified)
    h3_verified = soup.new_tag('h3')
    h3_verified.string = 'Verified Tests'
    card_verified.append(h3_verified)
    div_value_verified = soup.new_tag('div', **{'class': 'value'})
    div_value_verified.string = str(metrics['verified_tests'])
    card_verified.append(div_value_verified)

    # Third row: Precision, Recall, F1 Score (Macro Avg.)
    metric_section2 = soup.new_tag('div', **{'class': 'metric-section'})
    summary_section.append(metric_section2)

    summary_cards3 = soup.new_tag('div', **{'class': 'summary-cards'})
    metric_section2.append(summary_cards3)

    card_prec_macro = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards3.append(card_prec_macro)
    h3_prec_macro = soup.new_tag('h3')
    h3_prec_macro.string = 'Precision (Macro Avg.)'
    card_prec_macro.append(h3_prec_macro)
    div_value_prec_macro = soup.new_tag('div', **{'class': 'value'})
    div_value_prec_macro.string = format_percentage(metrics['avg_precision'])
    card_prec_macro.append(div_value_prec_macro)

    card_rec_macro = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards3.append(card_rec_macro)
    h3_rec_macro = soup.new_tag('h3')
    h3_rec_macro.string = 'Recall (Macro Avg.)'
    card_rec_macro.append(h3_rec_macro)
    div_value_rec_macro = soup.new_tag('div', **{'class': 'value'})
    div_value_rec_macro.string = format_percentage(metrics['avg_recall'])
    card_rec_macro.append(div_value_rec_macro)

    card_f1_macro = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards3.append(card_f1_macro)
    h3_f1_macro = soup.new_tag('h3')
    h3_f1_macro.string = 'F1 Score (Macro Avg.)'
    card_f1_macro.append(h3_f1_macro)
    div_value_f1_macro = soup.new_tag('div', **{'class': 'value'})
    div_value_f1_macro.string = format_percentage(metrics['avg_f1_score'])
    card_f1_macro.append(div_value_f1_macro)

    # Fourth row: Precision, Recall, F1 Score (Micro Avg.)
    metric_section3 = soup.new_tag('div', **{'class': 'metric-section'})
    summary_section.append(metric_section3)

    summary_cards4 = soup.new_tag('div', **{'class': 'summary-cards'})
    metric_section3.append(summary_cards4)

    card_prec_micro = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards4.append(card_prec_micro)
    h3_prec_micro = soup.new_tag('h3')
    h3_prec_micro.string = 'Precision (Micro Avg.)'
    card_prec_micro.append(h3_prec_micro)
    div_value_prec_micro = soup.new_tag('div', **{'class': 'value'})
    div_value_prec_micro.string = format_percentage(metrics['micro_precision'])
    card_prec_micro.append(div_value_prec_micro)

    card_rec_micro2 = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards4.append(card_rec_micro2)
    h3_rec_micro2 = soup.new_tag('h3')
    h3_rec_micro2.string = 'Recall (Micro Avg.)'
    card_rec_micro2.append(h3_rec_micro2)
    div_value_rec_micro2 = soup.new_tag('div', **{'class': 'value'})
    div_value_rec_micro2.string = format_percentage(metrics['micro_recall'])
    card_rec_micro2.append(div_value_rec_micro2)

    card_f1_micro = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards4.append(card_f1_micro)
    h3_f1_micro = soup.new_tag('h3')
    h3_f1_micro.string = 'F1 Score (Micro Avg.)'
    card_f1_micro.append(h3_f1_micro)
    div_value_f1_micro = soup.new_tag('div', **{'class': 'value'})
    div_value_f1_micro.string = format_percentage(metrics['micro_f1_score'])
    card_f1_micro.append(div_value_f1_micro)

    # Fifth row: Costs
    summary_cards5 = soup.new_tag('div', **{'class': 'summary-cards'})
    summary_section.append(summary_cards5)

    card_gen_cost = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards5.append(card_gen_cost)
    h3_gen_cost = soup.new_tag('h3')
    h3_gen_cost.string = 'Total Generation Cost'
    card_gen_cost.append(h3_gen_cost)
    div_value_gen_cost = soup.new_tag('div', **{'class': 'value'})
    div_value_gen_cost.string = f'${format_metric(metrics["total_generation_cost"])}'
    card_gen_cost.append(div_value_gen_cost)

    card_ver_cost = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards5.append(card_ver_cost)
    h3_ver_cost = soup.new_tag('h3')
    h3_ver_cost.string = 'Total Verification Cost'
    card_ver_cost.append(h3_ver_cost)
    div_value_ver_cost = soup.new_tag('div', **{'class': 'value'})
    div_value_ver_cost.string = f'${format_metric(metrics["total_verification_cost"])}'
    card_ver_cost.append(div_value_ver_cost)

    card_total_cost = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards5.append(card_total_cost)
    h3_total_cost = soup.new_tag('h3')
    h3_total_cost.string = 'Total Cost'
    card_total_cost.append(h3_total_cost)
    div_value_total_cost = soup.new_tag('div', **{'class': 'value'})
    div_value_total_cost.string = f'${format_metric(metrics["total_cost"])}'
    card_total_cost.append(div_value_total_cost)

    # Sixth row: Execution Times and Failed Environments
    summary_cards6 = soup.new_tag('div', **{'class': 'summary-cards'})
    summary_section.append(summary_cards6)

    card_total_time = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards6.append(card_total_time)
    h3_total_time = soup.new_tag('h3')
    h3_total_time.string = 'Total Execution Time'
    card_total_time.append(h3_total_time)
    div_value_total_time = soup.new_tag('div', **{'class': 'value'})
    div_value_total_time.string = format_time(metrics['total_execution_time'])
    card_total_time.append(div_value_total_time)

    card_avg_time = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards6.append(card_avg_time)
    h3_avg_time = soup.new_tag('h3')
    h3_avg_time.string = 'Avg Execution Time'
    card_avg_time.append(h3_avg_time)
    div_value_avg_time = soup.new_tag('div', **{'class': 'value'})
    div_value_avg_time.string = format_time(metrics['avg_execution_time'])
    card_avg_time.append(div_value_avg_time)

    card_failed_envs = soup.new_tag('div', **{'class': 'summary-card'})
    summary_cards6.append(card_failed_envs)
    h3_failed_envs = soup.new_tag('h3')
    h3_failed_envs.string = 'Failed Environments'
    card_failed_envs.append(h3_failed_envs)
    div_value_failed_envs = soup.new_tag('div', **{'class': 'value'})
    div_value_failed_envs.string = str(metrics['failed_environments'])
    card_failed_envs.append(div_value_failed_envs)

    # Main Metrics Section with Histograms
    main_metrics_section = soup.new_tag('div', **{'class': 'report-section'})
    body_tag.append(main_metrics_section)

    btn_main_metrics = soup.new_tag('button', **{'class': 'collapsible'})
    btn_main_metrics.string = 'Main Metrics'
    main_metrics_section.append(btn_main_metrics)

    content_main_metrics = soup.new_tag('div', **{'class': 'content'})
    main_metrics_section.append(content_main_metrics)

    h3_main_perf = soup.new_tag('h3')
    h3_main_perf.string = 'Main Performance Metrics'
    content_main_metrics.append(h3_main_perf)

    # Precision Histogram
    hist_div_prec = soup.new_tag('div', **{'class': 'histogram'})
    content_main_metrics.append(hist_div_prec)
    h4_prec = soup.new_tag('h4')
    h4_prec.string = 'Precision Distribution'
    hist_div_prec.append(h4_prec)
    hist_div_prec.append(
        BeautifulSoup(
            create_histogram(
                metrics['precision'], 'Precision Distribution', 'Precision'
            ),
            'html.parser',
        )
    )

    # Recall Histogram
    hist_div_rec = soup.new_tag('div', **{'class': 'histogram'})
    content_main_metrics.append(hist_div_rec)
    h4_rec = soup.new_tag('h4')
    h4_rec.string = 'Recall Distribution'
    hist_div_rec.append(h4_rec)
    hist_div_rec.append(
        BeautifulSoup(
            create_histogram(metrics['recall'], 'Recall Distribution', 'Recall'),
            'html.parser',
        )
    )

    # F1 Score Histogram
    hist_div_f1 = soup.new_tag('div', **{'class': 'histogram'})
    content_main_metrics.append(hist_div_f1)
    h4_f1 = soup.new_tag('h4')
    h4_f1.string = 'F1 Score Distribution'
    hist_div_f1.append(h4_f1)
    hist_div_f1.append(
        BeautifulSoup(
            create_histogram(metrics['f1_score'], 'F1 Score Distribution', 'F1 Score'),
            'html.parser',
        )
    )

    # Requirement Coverage Histogram
    hist_div_req_cov = soup.new_tag('div', **{'class': 'histogram'})
    content_main_metrics.append(hist_div_req_cov)
    h4_req_cov = soup.new_tag('h4')
    h4_req_cov.string = 'Requirement Coverage Distribution'
    hist_div_req_cov.append(h4_req_cov)
    hist_div_req_cov.append(
        BeautifulSoup(
            create_histogram(
                metrics['requirement_coverage'],
                'Requirement Coverage Distribution',
                'Requirement Coverage',
            ),
            'html.parser',
        )
    )

    # Coverage Section with ATG Comparison
    coverage_section = soup.new_tag('div', **{'class': 'report-section'})
    body_tag.append(coverage_section)

    btn_coverage = soup.new_tag('button', **{'class': 'collapsible'})
    btn_coverage.string = 'Coverage Metrics'
    coverage_section.append(btn_coverage)

    content_coverage = soup.new_tag('div', **{'class': 'content'})
    coverage_section.append(content_coverage)

    h3_cov_header = soup.new_tag('h3')
    h3_cov_header.string = 'Code Coverage Comparison'
    content_coverage.append(h3_cov_header)

    # Legend
    legend_cov = soup.new_tag('div', **{'class': 'coverage-legend'})
    content_coverage.append(legend_cov)

    legend_item_our = soup.new_tag('div', **{'class': 'legend-item'})
    legend_cov.append(legend_item_our)
    color_our = soup.new_tag(
        'div', **{'class': 'legend-color'}, style='background-color: #3498db;'
    )
    legend_item_our.append(color_our)
    span_our = soup.new_tag('span')
    span_our.string = 'Our Tests'
    legend_item_our.append(span_our)

    legend_item_atg = soup.new_tag('div', **{'class': 'legend-item'})
    legend_cov.append(legend_item_atg)
    color_atg = soup.new_tag(
        'div', **{'class': 'legend-color'}, style='background-color: #e74c3c;'
    )
    legend_item_atg.append(color_atg)
    span_atg = soup.new_tag('span')
    span_atg.string = 'ATG Tests'
    legend_item_atg.append(span_atg)

    # Coverage bars container
    coverage_bars = soup.new_tag('div', **{'class': 'coverage-bars'})
    content_coverage.append(coverage_bars)

    # Compute mean coverage values
    mean_stmt = np.mean([c for c in metrics['statement_coverage'] if c is not None])
    mean_atg_stmt = np.mean(
        [c for c in metrics['atg_statement_coverage'] if c is not None]
    )
    mean_branch = np.mean([c for c in metrics['branch_coverage'] if c is not None])
    mean_atg_branch = np.mean(
        [c for c in metrics['atg_branch_coverage'] if c is not None]
    )

    # Statement Coverage bar
    bar_stmt = soup.new_tag('div', **{'class': 'coverage-bar'})
    coverage_bars.append(bar_stmt)
    label_stmt = soup.new_tag('div', **{'class': 'label'})
    bar_stmt.append(label_stmt)
    span_label_stmt = soup.new_tag('span')
    span_label_stmt.string = 'Statement Coverage'
    label_stmt.append(span_label_stmt)
    span_values_stmt = soup.new_tag('span')
    span_values_stmt.string = f'Our: {mean_stmt:.2%} | ATG: {mean_atg_stmt:.2%}'
    label_stmt.append(span_values_stmt)

    bar_container_stmt = soup.new_tag('div', **{'class': 'bar-container'})
    bar_stmt.append(bar_container_stmt)
    bar_fill_stmt = soup.new_tag(
        'div', **{'class': 'bar-fill'}, style=f'width: {mean_stmt:.2%};'
    )
    bar_container_stmt.append(bar_fill_stmt)
    atg_fill_stmt = soup.new_tag(
        'div', **{'class': 'atg-bar-fill'}, style=f'width: {mean_atg_stmt:.2%};'
    )
    bar_container_stmt.append(atg_fill_stmt)

    # Branch Coverage bar
    bar_branch = soup.new_tag('div', **{'class': 'coverage-bar'})
    coverage_bars.append(bar_branch)
    label_branch = soup.new_tag('div', **{'class': 'label'})
    bar_branch.append(label_branch)
    span_label_branch = soup.new_tag('span')
    span_label_branch.string = 'Branch Coverage'
    label_branch.append(span_label_branch)
    span_values_branch = soup.new_tag('span')
    span_values_branch.string = f'Our: {mean_branch:.2%} | ATG: {mean_atg_branch:.2%}'
    label_branch.append(span_values_branch)

    bar_container_branch = soup.new_tag('div', **{'class': 'bar-container'})
    bar_branch.append(bar_container_branch)
    bar_fill_branch = soup.new_tag(
        'div', **{'class': 'bar-fill'}, style=f'width: {mean_branch:.2%};'
    )
    bar_container_branch.append(bar_fill_branch)
    atg_fill_branch = soup.new_tag(
        'div', **{'class': 'atg-bar-fill'}, style=f'width: {mean_atg_branch:.2%};'
    )
    bar_container_branch.append(atg_fill_branch)

    # Histograms grid
    hist_grid = soup.new_tag('div', **{'class': 'histogram-grid'})
    content_coverage.append(hist_grid)

    # Statement Coverage Distribution
    hist_container_stmt = soup.new_tag('div', **{'class': 'histogram-container'})
    hist_grid.append(hist_container_stmt)
    hist_header_stmt = soup.new_tag('div', **{'class': 'histogram-header'})
    hist_header_stmt.string = 'Statement Coverage Distribution'
    hist_container_stmt.append(hist_header_stmt)
    hist_container_stmt.append(
        BeautifulSoup(
            create_histogram(
                [c for c in metrics['statement_coverage'] if c is not None],
                'Statement Coverage Distribution',
                'Statement Coverage',
            ),
            'html.parser',
        )
    )

    # ATG Statement Coverage Distribution
    hist_container_atg_stmt = soup.new_tag('div', **{'class': 'histogram-container'})
    hist_grid.append(hist_container_atg_stmt)
    hist_header_atg_stmt = soup.new_tag('div', **{'class': 'histogram-header'})
    hist_header_atg_stmt.string = 'ATG Statement Coverage Distribution'
    hist_container_atg_stmt.append(hist_header_atg_stmt)
    hist_container_atg_stmt.append(
        BeautifulSoup(
            create_histogram(
                [c for c in metrics['atg_statement_coverage'] if c is not None],
                'ATG Statement Coverage Distribution',
                'Statement Coverage',
            ),
            'html.parser',
        )
    )

    # Branch Coverage Distribution
    hist_container_branch = soup.new_tag('div', **{'class': 'histogram-container'})
    hist_grid.append(hist_container_branch)
    hist_header_branch = soup.new_tag('div', **{'class': 'histogram-header'})
    hist_header_branch.string = 'Branch Coverage Distribution'
    hist_container_branch.append(hist_header_branch)
    hist_container_branch.append(
        BeautifulSoup(
            create_histogram(
                [c for c in metrics['branch_coverage'] if c is not None],
                'Branch Coverage Distribution',
                'Branch Coverage',
            ),
            'html.parser',
        )
    )

    # ATG Branch Coverage Distribution
    hist_container_atg_branch = soup.new_tag('div', **{'class': 'histogram-container'})
    hist_grid.append(hist_container_atg_branch)
    hist_header_atg_branch = soup.new_tag('div', **{'class': 'histogram-header'})
    hist_header_atg_branch.string = 'ATG Branch Coverage Distribution'
    hist_container_atg_branch.append(hist_header_atg_branch)
    hist_container_atg_branch.append(
        BeautifulSoup(
            create_histogram(
                [c for c in metrics['atg_branch_coverage'] if c is not None],
                'ATG Branch Coverage Distribution',
                'Branch Coverage',
            ),
            'html.parser',
        )
    )

    # Uncovered lines section
    h3_cov_header = soup.new_tag('h3')
    h3_cov_header.string = 'Uncovered Lines'
    content_coverage.append(h3_cov_header)
    all_uncovered_reqs = [
        r
        for result in results
        for r in result.requirement_coverage_results
        if not r['fully_covered']
    ]
    if not all_uncovered_reqs:
        p_no_uncovered = soup.new_tag('p')
        p_no_uncovered.string = 'No uncovered lines found.'
        content_coverage.append(p_no_uncovered)
    else:
        for result in results:
            uncovered_reqs = [
                r for r in result.requirement_coverage_results if not r['fully_covered']
            ]
            if not uncovered_reqs:
                continue
            env_name = Path(result.environment_path).stem

            env_section = soup.new_tag('div')
            content_coverage.append(env_section)

            btn_env = soup.new_tag('button', **{'class': 'collapsible'})
            btn_env.string = env_name
            env_section.append(btn_env)

            content_env = soup.new_tag('div', **{'class': 'content'})
            env_section.append(content_env)

            pre = soup.new_tag('pre')
            content_env.append(pre)

            for ul in _extract_uncovered_lines(result):
                tooltip_text = f'{ul["requirement_id"]} – {ul["requirement_text"]}'
                span_line = soup.new_tag('span', title=tooltip_text)
                span_line.string = f'{ul["line_number"]}\t{ul["source_line"]}'
                pre.append(span_line)
                pre.append('\n')

    # Fallback Metrics Section
    fallback_section = soup.new_tag('div', **{'class': 'report-section'})
    body_tag.append(fallback_section)

    btn_fallback = soup.new_tag('button', **{'class': 'collapsible'})
    btn_fallback.string = 'Fallback Metrics'
    fallback_section.append(btn_fallback)

    content_fallback = soup.new_tag('div', **{'class': 'content'})
    fallback_section.append(content_fallback)

    h3_fallback_title = soup.new_tag('h3')
    h3_fallback_title.string = 'Fallback Usage Metrics (Macro Avg.)'
    content_fallback.append(h3_fallback_title)

    metric_grid = soup.new_tag('div', **{'class': 'metric-grid'})
    content_fallback.append(metric_grid)

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
        avg_val = np.mean(values)
        card = soup.new_tag('div', **{'class': 'metric-card'})
        metric_grid.append(card)
        name_div = soup.new_tag('div', **{'class': 'metric-name'})
        name_div.string = name
        card.append(name_div)
        value_div = soup.new_tag('div', **{'class': 'metric-value'})
        value_div.string = format_percentage(avg_val)
        card.append(value_div)

    h3_fallback_dist = soup.new_tag('h3')
    h3_fallback_dist.string = 'Fallback Metrics Distributions'
    content_fallback.append(h3_fallback_dist)

    hist_grid_fallback = soup.new_tag('div', **{'class': 'histogram-grid'})
    content_fallback.append(hist_grid_fallback)

    for name, values in fallback_metrics:
        hist_cont = soup.new_tag('div', **{'class': 'histogram-container'})
        hist_grid_fallback.append(hist_cont)
        hist_header = soup.new_tag('div', **{'class': 'histogram-header'})
        hist_header.string = f'{name} Distribution'
        hist_cont.append(hist_header)
        hist_cont.append(
            BeautifulSoup(
                create_histogram(values, f'{name} Distribution', name), 'html.parser'
            )
        )

    # Individual Results Section
    individual_section = soup.new_tag('div', **{'class': 'report-section'})
    body_tag.append(individual_section)

    btn_indiv = soup.new_tag('button', **{'class': 'collapsible'})
    btn_indiv.string = 'Individual Environment Results'
    individual_section.append(btn_indiv)

    content_indiv = soup.new_tag('div', **{'class': 'content'})
    individual_section.append(content_indiv)

    for result in results:
        env_name = Path(result.environment_path).stem

        btn_env = soup.new_tag('button', **{'class': 'collapsible'})
        btn_env.string = env_name
        content_indiv.append(btn_env)

        content_env = soup.new_tag('div', **{'class': 'content'})
        content_indiv.append(content_env)

        h4_env = soup.new_tag('h4')
        h4_env.string = f'Environment: {result.environment_path}'
        content_env.append(h4_env)

        # Summary cards for this environment
        sum_cards_env1 = soup.new_tag('div', **{'class': 'summary-cards'})
        content_env.append(sum_cards_env1)

        card_env_req = soup.new_tag('div', **{'class': 'summary-card'})
        sum_cards_env1.append(card_env_req)
        h3_env_req = soup.new_tag('h3')
        h3_env_req.string = 'Requirements'
        card_env_req.append(h3_env_req)
        div_env_req = soup.new_tag('div', **{'class': 'value'})
        div_env_req.string = str(result.total_requirements)
        card_env_req.append(div_env_req)

        card_env_gen = soup.new_tag('div', **{'class': 'summary-card'})
        sum_cards_env1.append(card_env_gen)
        h3_env_gen = soup.new_tag('h3')
        h3_env_gen.string = 'Generated Tests'
        card_env_gen.append(h3_env_gen)
        div_env_gen = soup.new_tag('div', **{'class': 'value'})
        div_env_gen.string = str(result.generated_tests)
        card_env_gen.append(div_env_gen)

        card_env_ver = soup.new_tag('div', **{'class': 'summary-card'})
        sum_cards_env1.append(card_env_ver)
        h3_env_ver = soup.new_tag('h3')
        h3_env_ver.string = 'Verified Tests'
        card_env_ver.append(h3_env_ver)
        div_env_ver = soup.new_tag('div', **{'class': 'value'})
        div_env_ver.string = str(result.verified_tests)
        card_env_ver.append(div_env_ver)

        # Precision, Recall, F1 for this env
        sum_cards_env2 = soup.new_tag('div', **{'class': 'summary-cards'})
        content_env.append(sum_cards_env2)

        card_env_prec = soup.new_tag('div', **{'class': 'summary-card'})
        sum_cards_env2.append(card_env_prec)
        h3_env_prec = soup.new_tag('h3')
        h3_env_prec.string = 'Precision'
        card_env_prec.append(h3_env_prec)
        div_env_prec_val = soup.new_tag('div', **{'class': 'value'})
        div_env_prec_val.string = format_percentage(result.precision)
        card_env_prec.append(div_env_prec_val)

        card_env_rec = soup.new_tag('div', **{'class': 'summary-card'})
        sum_cards_env2.append(card_env_rec)
        h3_env_rec = soup.new_tag('h3')
        h3_env_rec.string = 'Recall'
        card_env_rec.append(h3_env_rec)
        div_env_rec_val = soup.new_tag('div', **{'class': 'value'})
        div_env_rec_val.string = format_percentage(result.recall)
        card_env_rec.append(div_env_rec_val)

        card_env_f1 = soup.new_tag('div', **{'class': 'summary-card'})
        sum_cards_env2.append(card_env_f1)
        h3_env_f1 = soup.new_tag('h3')
        h3_env_f1.string = 'F1 Score'
        card_env_f1.append(h3_env_f1)
        div_env_f1_val = soup.new_tag('div', **{'class': 'value'})
        div_env_f1_val.string = format_percentage(result.f1_score)
        card_env_f1.append(div_env_f1_val)

        # Requirement Coverage for this env
        sum_cards_env3 = soup.new_tag('div', **{'class': 'summary-cards'})
        content_env.append(sum_cards_env3)

        card_env_req_cov = soup.new_tag('div', **{'class': 'summary-card'})
        sum_cards_env3.append(card_env_req_cov)
        h3_env_req_cov = soup.new_tag('h3')
        h3_env_req_cov.string = 'Requirement Coverage'
        card_env_req_cov.append(h3_env_req_cov)
        div_env_req_cov_val = soup.new_tag('div', **{'class': 'value'})
        div_env_req_cov_val.string = format_percentage(result.requirement_coverage)
        card_env_req_cov.append(div_env_req_cov_val)

        # Coverage Information header
        h4_cov_info = soup.new_tag('h4')
        h4_cov_info.string = 'Coverage Information'
        content_env.append(h4_cov_info)

        # Determine coverage values
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

        # Legend for this environment
        legend_env = soup.new_tag('div', **{'class': 'coverage-legend'})
        content_env.append(legend_env)

        legend_item_env_our = soup.new_tag('div', **{'class': 'legend-item'})
        legend_env.append(legend_item_env_our)
        color_env_our = soup.new_tag(
            'div', **{'class': 'legend-color'}, style='background-color: #3498db;'
        )
        legend_item_env_our.append(color_env_our)
        span_env_our = soup.new_tag('span')
        span_env_our.string = 'Our Tests'
        legend_item_env_our.append(span_env_our)

        legend_item_env_atg = soup.new_tag('div', **{'class': 'legend-item'})
        legend_env.append(legend_item_env_atg)
        color_env_atg = soup.new_tag(
            'div', **{'class': 'legend-color'}, style='background-color: #e74c3c;'
        )
        legend_item_env_atg.append(color_env_atg)
        span_env_atg = soup.new_tag('span')
        span_env_atg.string = 'ATG Tests'
        legend_item_env_atg.append(span_env_atg)

        # Coverage bars for this environment
        coverage_bars_env = soup.new_tag('div', **{'class': 'coverage-bars'})
        content_env.append(coverage_bars_env)

        # Statement Coverage bar
        bar_env_stmt = soup.new_tag('div', **{'class': 'coverage-bar'})
        coverage_bars_env.append(bar_env_stmt)
        label_env_stmt = soup.new_tag('div', **{'class': 'label'})
        bar_env_stmt.append(label_env_stmt)
        span_label_env_stmt = soup.new_tag('span')
        span_label_env_stmt.string = 'Statement Coverage'
        label_env_stmt.append(span_label_env_stmt)
        span_values_env_stmt = soup.new_tag('span')
        span_values_env_stmt.string = f'Our: {stmt_cov:.2%} | ATG: {atg_stmt_cov:.2%}'
        label_env_stmt.append(span_values_env_stmt)

        bar_container_env_stmt = soup.new_tag('div', **{'class': 'bar-container'})
        bar_env_stmt.append(bar_container_env_stmt)
        bar_fill_env_stmt = soup.new_tag(
            'div', **{'class': 'bar-fill'}, style=f'width: {stmt_cov:.2%};'
        )
        bar_container_env_stmt.append(bar_fill_env_stmt)
        atg_fill_env_stmt = soup.new_tag(
            'div', **{'class': 'atg-bar-fill'}, style=f'width: {atg_stmt_cov:.2%};'
        )
        bar_container_env_stmt.append(atg_fill_env_stmt)

        # Branch Coverage bar
        bar_env_branch = soup.new_tag('div', **{'class': 'coverage-bar'})
        coverage_bars_env.append(bar_env_branch)
        label_env_branch = soup.new_tag('div', **{'class': 'label'})
        bar_env_branch.append(label_env_branch)
        span_label_env_branch = soup.new_tag('span')
        span_label_env_branch.string = 'Branch Coverage'
        label_env_branch.append(span_label_env_branch)
        span_values_env_branch = soup.new_tag('span')
        span_values_env_branch.string = (
            f'Our: {branch_cov:.2%} | ATG: {atg_branch_cov:.2%}'
        )
        label_env_branch.append(span_values_env_branch)

        bar_container_env_branch = soup.new_tag('div', **{'class': 'bar-container'})
        bar_env_branch.append(bar_container_env_branch)
        bar_fill_env_branch = soup.new_tag(
            'div', **{'class': 'bar-fill'}, style=f'width: {branch_cov:.2%};'
        )
        bar_container_env_branch.append(bar_fill_env_branch)
        atg_fill_env_branch = soup.new_tag(
            'div', **{'class': 'atg-bar-fill'}, style=f'width: {atg_branch_cov:.2%};'
        )
        bar_container_env_branch.append(atg_fill_env_branch)

        # Uncovered requirements
        h4_uncov_req = soup.new_tag('h4')
        h4_uncov_req.string = 'Uncovered Requirements'
        content_env.append(h4_uncov_req)
        uncovered_reqs = [
            r for r in result.requirement_coverage_results if not r['fully_covered']
        ]
        if not uncovered_reqs:
            p_no_uncov = soup.new_tag('p')
            p_no_uncov.string = 'All requirements are covered.'
            content_env.append(p_no_uncov)
        else:
            ul_uncov = soup.new_tag('ul')
            content_env.append(ul_uncov)
            for req in uncovered_reqs:
                req_id = req['requirement_id']
                req_text = result.requirements_data[req_id]['title']
                link_to_req = f'./{env_name}/coverage_reports/{req_id}_coverage.html'
                test_case = test_cases.get(env_name, {}).get(
                    req_id, 'Test case not found'
                )
                if isinstance(test_case, dict):
                    test_case = json.dumps(test_case, indent=4)

                li_uncov = soup.new_tag('li')
                a_uncov = soup.new_tag('a', href=link_to_req)
                a_uncov.string = req_id
                li_uncov.append(a_uncov)
                p = soup.new_tag('p')
                p.string = req_text
                li_uncov.append(p)

                collapsible = soup.new_tag('div', **{'class': 'collapsible'})
                collapsible['style'] = (
                    'cursor:pointer; padding:4px 8px; '
                    'background:#eee; border:1px solid #ccc; margin-top:4px;'
                )
                collapsible.string = '▶ Show Test Case'
                li_uncov.append(collapsible)

                content = soup.new_tag('div', **{'class': 'content'})
                content['style'] = (
                    'max-height:0; overflow:hidden; '
                    'transition:max-height 0.2s ease-out; '
                    'padding:0 8px; border:1px solid #ccc; '
                    'border-top:none; background:#fafafa;'
                )
                pre = soup.new_tag('pre')
                pre.string = test_case
                pre['style'] = 'max-height: 500px; overflow: scroll;'
                content.append(pre)
                li_uncov.append(content)

                ul_uncov.append(li_uncov)

        # Fallback Metrics Table for this environment
        h4_fallback_env = soup.new_tag('h4')
        h4_fallback_env.string = 'Fallback Metrics'
        content_env.append(h4_fallback_env)

        table_fallback_env = soup.new_tag('table')
        content_env.append(table_fallback_env)
        tr_head = soup.new_tag('tr')
        table_fallback_env.append(tr_head)
        th_metric = soup.new_tag('th')
        th_metric.string = 'Metric'
        tr_head.append(th_metric)
        th_value = soup.new_tag('th')
        th_value.string = 'Value'
        tr_head.append(th_value)

        fallback_items_env = [
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

        for name, value in fallback_items_env:
            tr = soup.new_tag('tr')
            table_fallback_env.append(tr)
            td_name = soup.new_tag('td')
            td_name.string = name
            tr.append(td_name)
            td_val = soup.new_tag('td')
            td_val.string = format_percentage(value)
            tr.append(td_val)

        # Cost Information Table for this environment
        h4_cost_env = soup.new_tag('h4')
        h4_cost_env.string = 'Cost Information'
        content_env.append(h4_cost_env)

        table_cost_env = soup.new_tag('table')
        content_env.append(table_cost_env)
        tr_cost_head = soup.new_tag('tr')
        table_cost_env.append(tr_cost_head)
        th_cost_metric = soup.new_tag('th')
        th_cost_metric.string = 'Metric'
        tr_cost_head.append(th_cost_metric)
        th_cost_value = soup.new_tag('th')
        th_cost_value.string = 'Value'
        tr_cost_head.append(th_cost_value)

        tr_gen_cost_env = soup.new_tag('tr')
        table_cost_env.append(tr_gen_cost_env)
        td_gen_label = soup.new_tag('td')
        td_gen_label.string = 'Generation Cost'
        tr_gen_cost_env.append(td_gen_label)
        td_gen_val = soup.new_tag('td')
        td_gen_val.string = f'${result.total_generation_cost:.4f}'
        tr_gen_cost_env.append(td_gen_val)

        tr_ver_cost_env = soup.new_tag('tr')
        table_cost_env.append(tr_ver_cost_env)
        td_ver_label = soup.new_tag('td')
        td_ver_label.string = 'Verification Cost'
        tr_ver_cost_env.append(td_ver_label)
        td_ver_val = soup.new_tag('td')
        td_ver_val.string = f'${result.total_verification_cost:.4f}'
        tr_ver_cost_env.append(td_ver_val)

        tr_tot_cost_env = soup.new_tag('tr')
        table_cost_env.append(tr_tot_cost_env)
        td_tot_label = soup.new_tag('td')
        td_tot_label.string = 'Total Cost'
        tr_tot_cost_env.append(td_tot_label)
        td_tot_val = soup.new_tag('td')
        td_tot_val.string = f'${result.total_cost:.4f}'
        tr_tot_cost_env.append(td_tot_val)

        tr_exec_time_env = soup.new_tag('tr')
        table_cost_env.append(tr_exec_time_env)
        td_exec_label = soup.new_tag('td')
        td_exec_label.string = 'Execution Time'
        tr_exec_time_env.append(td_exec_label)
        td_exec_val = soup.new_tag('td')
        td_exec_val.string = format_time(result.execution_time)
        tr_exec_time_env.append(td_exec_val)

        # Error Information if present
        if result.generation_error:
            h4_error_env = soup.new_tag('h4')
            h4_error_env.string = 'Error Information'
            content_env.append(h4_error_env)

            div_error_env = soup.new_tag(
                'div',
                style='background-color: #ffeeee; padding: 10px; border-radius: 5px;',
            )
            content_env.append(div_error_env)
            pre_error = soup.new_tag('pre')
            pre_error.string = result.generation_error
            div_error_env.append(pre_error)

    # JavaScript Section for collapsible behavior
    script_tag = soup.new_tag('script')
    script_content = """
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
    """
    script_tag.string = script_content
    body_tag.append(script_tag)

    return soup


def force_unhide(soup: BeautifulSoup) -> None:
    for tag in soup.find_all(attrs={'style': True}):
        style = tag['style']
        if 'display:none' not in style.replace(' ', '').lower():
            continue
        cleaned = (
            ';'.join(
                part.strip()
                for part in style.split(';')
                if 'display' not in part.replace(' ', '').lower()
            )
            .strip()
            .rstrip(';')
        )
        if cleaned:
            tag['style'] = cleaned
        else:
            del tag['style']

    for tag in soup.find_all(hidden=True):
        del tag['hidden']

    for detail in soup.find_all('details'):
        detail['open'] = None

    collapse_classes = ('collapse', 'accordion-collapse')
    for tag in soup.find_all(class_=True):
        classes = tag.get('class', [])
        if not any(c in classes for c in collapse_classes):
            continue
        new_classes = [
            c for c in classes if c not in ('collapse', 'accordion-collapse')
        ]
        if new_classes:
            tag['class'] = new_classes
        else:
            del tag['class']


def create_markdown_report(
    results: List[EvaluationResult], soup: BeautifulSoup, markdown_base_url: str = None
) -> str:
    _soup = BeautifulSoup(str(soup), 'html.parser')
    force_unhide(_soup)

    h2 = _soup.new_tag('h2')
    h2.string = 'Uncovered lines recap'
    outer_ul = _soup.new_tag('ul')

    data = {}
    for r in results:
        env_name = Path(r.environment_path).stem
        for req in r.requirement_coverage_results:
            if req['fully_covered']:
                continue
            data.setdefault(env_name, {})
            data[env_name][req['requirement_id']] = [
                _l for _l in req['required_lines'] if _l not in req['covered_lines']
            ]

    for env, reqs in data.items():
        env_li = _soup.new_tag('li')
        env_li.string = env

        inner_ul = _soup.new_tag('ul')
        for req_id, lines in reqs.items():
            req_li = _soup.new_tag('li')
            req_li.string = f'{req_id}: {lines}'
            inner_ul.append(req_li)

        env_li.append(inner_ul)
        outer_ul.append(env_li)

    body = _soup.body
    body.insert(0, outer_ul)
    body.insert(0, h2)

    if markdown_base_url:
        for a in _soup.find_all('a'):
            href = a.get('href')
            if href and href.startswith('./'):
                a['href'] = markdown_base_url + href[2:]

    return md(str(_soup), strip=['img'], heading_style='ATX')


def create_report(
    result_folder: str, export_markdown: bool = False, markdown_base_url: str = None
) -> None:
    """Generate a report from results in the specified folder"""

    # Load results
    results = load_results(result_folder)
    if not results:
        print(f'No result files found in {result_folder}')
        return

    print(f'Loaded {len(results)} evaluation results')

    # Calculate aggregated metrics
    metrics = calculate_aggregated_metrics(results)

    # Load test cases
    test_cases = load_test_cases(result_folder)

    # Create HTML report
    html_report = create_html_report(results, metrics, test_cases)

    # Write report to file
    report_path = Path(result_folder) / 'evaluation_report.html'
    with open(report_path, 'w') as f:
        f.write(str(html_report))

    if export_markdown:
        md_report = create_markdown_report(
            results, html_report, markdown_base_url=markdown_base_url
        )
        md_report_path = Path(result_folder) / 'evaluation_report.md'
        with open(md_report_path, 'w') as f:
            f.write(md_report)

    print(f'Report generated at {report_path}')


def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(
        description='Generate HTML report from evaluation results'
    )
    parser.add_argument(
        'evaluation_results_folder',
        help=f'Folder containing evaluation result files',
    )
    parser.add_argument(
        '--markdown-base-url',
        required=False,
        type=str,
        help='Base URL for markdown links (e.g., "https://example.com/reports/")',
    )
    parser.add_argument(
        '--export-markdown',
        action='store_true',
        help='Export markdown together with HTML report',
    )
    args = parser.parse_args()

    # Generate report
    create_report(
        args.evaluation_results_folder,
        export_markdown=args.export_markdown,
        markdown_base_url=args.markdown_base_url,
    )


if __name__ == '__main__':
    main()
