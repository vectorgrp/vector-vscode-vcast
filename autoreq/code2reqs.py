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

from autoreq.util import ensure_env
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

def execute_command(command_list):
    try:
        result = subprocess.run(
            command_list,
            capture_output=True,
            text=True,
            shell=False  # More secure
        )
        if result.returncode != 0:
            logging.error(f"Error executing command: {' '.join(command_list)}")
            logging.error(result.stderr)
        else:
            logging.info(result.stdout)
        return result
    except Exception as e:
        logging.error(f"Failed to execute command: {e}")
        raise

def execute_rgw_commands(env_path, csv_path, export_repository):
    export_path = Path(export_repository)
    export_path.mkdir(parents=True, exist_ok=True)

    env_dir = Path(env_path).parent
    vectorcast_dir = os.environ.get('VECTORCAST_DIR', '')
    clicast = str(Path(vectorcast_dir) / 'clicast')
    if os.name == 'nt' and not clicast.endswith('.exe'):
        clicast += '.exe'

    # Convert paths to absolute and ensure proper formatting
    abs_export_path = str(export_path.resolve())
    abs_csv_path = str(Path(csv_path).resolve())

    rgw_prep_commands = [
        [clicast, '-lc', 'option', 'VCAST_REPOSITORY', abs_export_path],
        [clicast, '-lc', 'RGw', 'INitialize'],
        [clicast, '-lc', 'Rgw', 'Set', 'Gateway', 'CSV'],
        [clicast, '-lc', 'RGw', 'Configure', 'Set', 'CSV', 'csv_path', abs_csv_path],
        [clicast, '-lc', 'RGw', 'Configure', 'Set', 'CSV', 'use_attribute_filter', '0'],
        [clicast, '-lc', 'RGw', 'Configure', 'Set', 'CSV', 'filter_attribute'],
        [clicast, '-lc', 'RGw', 'Configure', 'Set', 'CSV', 'filter_attribute_value'],
        [clicast, '-lc', 'RGw', 'Configure', 'Set', 'CSV', 'id_attribute', 'ID'],
        [clicast, '-lc', 'RGw', 'Configure', 'Set', 'CSV', 'key_attribute', 'Key'],
        [clicast, '-lc', 'RGw', 'Configure', 'Set', 'CSV', 'title_attribute', 'Title'],
        [clicast, '-lc', 'RGw', 'Configure', 'Set', 'CSV', 'description_attribute', 'Description'],
        [clicast, '-lc', 'RGw', 'Import'],
    ]

    # Change working directory before executing commands
    original_dir = os.getcwd()
    try:
        os.chdir(str(env_dir))
        for command in rgw_prep_commands:
            execute_command(command)
    finally:
        os.chdir(original_dir)

def prompt_user_for_info(key):
    if key == 'OPENAI_API_KEY':
        return input("Please enter your OpenAI API key: ")
    elif key == 'OPENAI_GENERATION_DEPLOYMENT':
        return input("Please enter the OpenAI deployment for generation: ")
    elif key == 'OPENAI_ADVANCED_GENERATION_DEPLOYMENT':
        return input("Please enter the OpenAI deployment for advanced generation: ")
    elif key == 'OPENAI_API_BASE':
        return input("Please enter the OpenAI API base URL: ")

async def main(env_path, export_csv=None, export_html=None, export_repository=None, json_events=False, extended_reasoning=False):
    log_level = os.environ.get('LOG_LEVEL', 'WARNING').upper()
    numeric_level = getattr(logging, log_level, logging.INFO)
    logging.basicConfig(level=numeric_level)

    environment = Environment(env_path)
    environment.build()  # Build the environment to ensure master.db is available

    functions = environment.testable_functions

    generator = RequirementsGenerator(environment, extended_reasoning=extended_reasoning)

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
    parser.add_argument('--overwrite-env', action='store_true', help='Prompt user for environment variables even if they are already set.')
    parser.add_argument('--extended-reasoning', action='store_true', help='Use extended reasoning for test generation.')

    args = parser.parse_args()

    ensure_env(['OPENAI_API_KEY', 'OPENAI_API_BASE', 'OPENAI_GENERATION_DEPLOYMENT', 'OPENAI_ADVANCED_GENERATION_DEPLOYMENT'], fallback=prompt_user_for_info, force_fallback=args.overwrite_env)

    asyncio.run(main(
        args.env_path,
        args.export_csv,
        args.export_html,
        args.export_repository,
        json_events=args.json_events,
        extended_reasoning=args.extended_reasoning
    ))

if __name__ == "__main__":
    cli()