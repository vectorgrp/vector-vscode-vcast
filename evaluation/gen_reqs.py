#!/usr/bin/env python3
import asyncio
import argparse
import os
import random
import glob
from pathlib import Path
from tqdm import tqdm

from dotenv import load_dotenv

from autoreq.code2reqs import main as gen_reqs

load_dotenv()


async def gen_requirements(env_path, allow_existing=False):
    """Generate requirements for a given environment file."""
    env_file_folder_path = Path(env_path).parent

    if allow_existing and (env_file_folder_path / 'reqs.csv').exists():
        print(f'Requirements already exist for {env_path}')
        return True

    reqs_csv_path = env_file_folder_path / 'reqs.csv'
    reqs_html_path = env_file_folder_path / 'reqs.html'

    try:
        total_cost, _ = await gen_reqs(
            env_path,
            export_csv=reqs_csv_path,
            export_html=reqs_html_path,
            export_line_number=True,
        )
    except Exception:
        import traceback

        traceback.print_exc()
        return False

    return total_cost


async def process_environments(
    env_files, max_n, max_cost, output_file, allow_existing=False
):
    """Process environment files to generate requirements."""
    total_cost = 0
    selected_envs = []

    # Randomly select environments if necessary
    if len(env_files) > max_n:
        env_files = random.sample(env_files, max_n)

    for env_file in tqdm(env_files):
        if total_cost > max_cost:
            break

        cost = await gen_requirements(env_file, allow_existing=allow_existing)
        if cost is True:  # Skip if requirements already exist
            selected_envs.append(env_file)
            continue

        if cost is False:
            print(f'Failed to generate requirements for {env_file}')
            continue

        total_cost += cost
        selected_envs.append(env_file)
        print(f'Total cost: {total_cost}')
        print(f'Processed: {len(selected_envs)}/{len(env_files)}')

        # Write progress to file
        if output_file:
            output_dir = os.path.dirname(output_file)
            if output_dir and not os.path.exists(output_dir):
                os.makedirs(output_dir)

            with open(output_file, 'w') as f:
                f.write('\n'.join(selected_envs))

    return selected_envs, total_cost


async def main():
    parser = argparse.ArgumentParser(
        description='Generate requirements from environment files'
    )
    parser.add_argument(
        '--env-list',
        required=True,
        help='File containing list of environment files or directory to scan for .env files',
    )
    parser.add_argument(
        '--max-n',
        type=int,
        default=100,
        help='Maximum number of environments to process',
    )
    parser.add_argument('--max-cost', type=int, default=100, help='Maximum total cost')
    parser.add_argument(
        '--output', help='Output file to save processed environment list'
    )
    parser.add_argument(
        '--allow-existing',
        action='store_true',
        help='Skip generation if requirements already exist',
    )
    parser.add_argument('--seed', type=int, default=42, help='Random seed')

    args = parser.parse_args()
    random.seed(args.seed)

    # Get environment files
    if os.path.isdir(args.env_list):
        env_files = glob.glob(f'{args.env_list}/**/*.env', recursive=True)
    else:
        with open(args.env_list) as f:
            env_files = f.read().splitlines()

    print(f'Found {len(env_files)} environment files')

    selected_envs, total_cost = await process_environments(
        env_files, args.max_n, args.max_cost, args.output, args.allow_existing
    )

    print(f'Processed {len(selected_envs)} environments')
    print(f'Total cost: {total_cost}')


if __name__ == '__main__':
    asyncio.run(main())
