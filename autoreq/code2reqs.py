import argparse
import json
import shutil
from tqdm.asyncio import tqdm_asyncio
from pathlib import Path
import csv
import os
import subprocess
import tempfile
import asyncio
import logging

from autoreq.test_generation.vcast_context_builder import VcastContextBuilder

from .codebase import Codebase
from .test_generation.environment import Environment
from .requirement_generation.generation import RequirementsGenerator
from .util import TempCopy, replace_func_and_var

def save_requirements_to_json(requirements, output_file):
    with open(output_file, 'w') as f:
        json.dump(requirements, f, indent=4)

def save_requirements_to_csv(requirements, output_file):
    fieldnames = ['Key', 'ID', 'Module', 'Title', 'Description', 'Function']
    with open(output_file, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for req in requirements:
            writer.writerow(req)

def save_requirements_to_html(requirements, output_file):
    html_content = '''
    <html>
    <head>
        <title>Requirements</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; background-color: #ffffff; color: #000000; }
            h1 { color: #2c3e50; }
            h2 { color: #34495e; margin-top: 30px; }
            .requirement { background-color: #f7f7f7; padding: 15px; margin: 10px 0; border-radius: 5px; }
            .req-key { font-weight: bold; color: #2980b9; }
            .req-description { margin-top: 10px; color: #333333; }
        </style>
    </head>
    <body>
        <h1>Requirements</h1>
    '''
    # Group requirements by function
    requirements_by_function = {}
    for req in requirements:
        func_name = req['Function']
        requirements_by_function.setdefault(func_name, []).append(req)
    # Generate HTML content
    for func_name, reqs in requirements_by_function.items():
        html_content += f'<h2>{func_name}</h2>'
        for req in reqs:
            html_content += f'''
            <div class="requirement">
                <div class="req-key">{req['Key']}</div>
                <div class="req-description">{req['Description']}</div>
            </div>
            '''
    html_content += '</body></html>'
    with open(output_file, 'w') as f:
        f.write(html_content)

def execute_command(command):
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        logging.error(f"Error executing command: {command}")
        logging.error(result.stdout)
    else:
        logging.info(result.stdout)

def execute_rgw_commands(env_path, csv_path, export_repository):
    Path(export_repository).mkdir(parents=True, exist_ok=True)

    env_dir = os.path.dirname(env_path)
    command_prefix = f"cd {env_dir} && $VECTORCAST_DIR/clicast -lc"

    rgw_prep_commands = [
        f"{command_prefix} option VCAST_REPOSITORY {os.path.abspath(export_repository)}",
        f"{command_prefix} RGw INitialize",
        f"{command_prefix} Rgw Set Gateway CSV",
        f"{command_prefix} RGw Configure Set CSV csv_path {os.path.abspath(csv_path)}",
        f"{command_prefix} RGw Configure Set CSV use_attribute_filter 0",
        f"{command_prefix} RGw Configure Set CSV filter_attribute",
        f"{command_prefix} RGw Configure Set CSV filter_attribute_value",
        f"{command_prefix} RGw Configure Set CSV id_attribute ID",
        f"{command_prefix} RGw Configure Set CSV key_attribute Key",
        f"{command_prefix} RGw Configure Set CSV title_attribute Title",
        f"{command_prefix} RGw Configure Set CSV description_attribute Description",
        f"{command_prefix} RGw Import",
    ]

    for rgw_prep_command in rgw_prep_commands:
        execute_command(rgw_prep_command)

async def main(env_path, export_csv=None, export_html=None, export_repository=None, json_events=False):
    log_level = os.environ.get('LOG_LEVEL', 'WARNING').upper()
    numeric_level = getattr(logging, log_level, logging.INFO)
    logging.basicConfig(level=numeric_level)

    environment = Environment(env_path)
    environment.build()  # Build the environment to ensure master.db is available

    functions = environment.testable_functions

    generator = RequirementsGenerator(environment)

    context_builder = VcastContextBuilder(environment)

    requirements = []

    # Initialize progress tracking
    total_functions = len(functions)
    processed_functions = 0

    async def generate_requirements(func):
        nonlocal processed_functions
        func_name = func['name']
        func_file = func['file']
        func_code = environment.tu_codebase.find_definitions_by_name(func_name)[0]
        result = await generator.generate(func_code, func_name)
        processed_functions += 1
        progress = processed_functions / total_functions

        if json_events:
            print(json.dumps({'event': 'progress', 'value': progress}), flush=True)

        if result:
            module = os.path.basename(func_file).replace('.cpp', '').replace('.c', '').title()
            for i, req in enumerate(result):
                req_id = f"{func_name}.{i+1}"
                requirement = {
                    'Key': req_id,
                    'ID': req_id,
                    'Module': module,
                    'Title': req,
                    'Description': req,
                    'Function': func_name
                }
                requirements.append(requirement)

    await tqdm_asyncio.gather(*[generate_requirements(func) for func in functions])

    environment.cleanup()

    if export_csv:
        csv_path = export_csv
        save_requirements_to_csv(requirements, csv_path)
    else:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".csv") as temp_csv:
            csv_path = temp_csv.name
        save_requirements_to_csv(requirements, csv_path)

    if export_html:
        save_requirements_to_html(requirements, export_html)

    if export_repository:
        execute_rgw_commands(env_path, csv_path, export_repository)

def cli():
    parser = argparse.ArgumentParser(description="Decompose design of functions into requirements.")
    parser.add_argument("env_path", help="Path to the VectorCAST environment directory.")
    parser.add_argument("--export-csv", help="Path to the output CSV file for requirements.")
    parser.add_argument("--export-html", help="Optional path to the output HTML file for pretty-printed requirements.")
    parser.add_argument("--export-repository", help="Path to the VCAST_REPOSITORY for registering requirements.")
    parser.add_argument('--json-events', action='store_true', help='Output events in JSON format.')

    args = parser.parse_args()

    asyncio.run(main(
        args.env_path,
        args.export_csv,
        args.export_html,
        args.export_repository,
        json_events=args.json_events
    ))

if __name__ == "__main__":
    cli()