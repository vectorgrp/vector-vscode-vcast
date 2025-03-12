import shutil
import os
import argparse
from pathlib import Path

from tqdm import tqdm


def get_env_dir(env_file):
    return Path(env_file).parent

def get_env_name(env_file):
    return Path(env_file).stem.split('.')[0]

def parse_env_line(line):
    """Parse a line that may contain env_file:config_file format"""
    parts = line.split(':', 1)  # Split on first colon only
    env_file = parts[0].strip()
    req_file = parts[1].strip() if len(parts) > 1 else None
    return env_file, req_file

def export_environments(input_file, output_dir, project_name, create_tar=False):
    # Read environment files from input file
    with open(input_file) as f:
        env_lines = f.read().splitlines()
    
    # Parse environment lines
    env_entries = [parse_env_line(line) for line in env_lines]
    
    # Prepare output directories
    export_dir = Path(output_dir) / project_name
    env_export_dir = export_dir / "environments"
    
    # Delete existing export if it exists
    if export_dir.exists():
        shutil.rmtree(export_dir)
    
    # Create export directories
    env_export_dir.mkdir(parents=True, exist_ok=True)
    
    # Copy over the environment directories and any config files
    for env_file, req_file in tqdm(env_entries, desc="Copying environments"):
        env_dir = get_env_dir(env_file)
        env_name = get_env_name(env_file)
        new_env_dir = env_export_dir / env_name
        new_env_dir.mkdir(parents=True, exist_ok=True)
        
        # Copy the environment directory
        shutil.copytree(env_dir, new_env_dir, dirs_exist_ok=True)
        
        # If there's a config file, copy it as reqs.csv
        if req_file:
            config_path = Path(req_file)
            if config_path.exists():
                shutil.copy2(config_path, new_env_dir / "reqs.csv")
                print(f"Copied {req_file} to {new_env_dir}/reqs.csv")
            else:
                print(f"Warning: Requirement file {req_file} not found")
    
    # Create bench_envs.txt with relative paths (only using env_file part)
    relative_env_files = [
        f"{project_name}/environments/{get_env_name(env_file)}/{Path(env_file).name}" 
        for env_file, _ in env_entries
    ]
    
    with open(export_dir / "bench_envs.txt", "w") as f:
        f.write("\n".join(relative_env_files))
    
    # Create tar archive if requested
    if create_tar:
        tar_path = Path(output_dir) / f"{project_name}.tar.gz"
        print(f"Creating tarball at {tar_path}")
        os.system(f"tar -czvf {tar_path} -C {output_dir} {project_name}")
    
    print(f"Export completed to {export_dir}")

def main():
    parser = argparse.ArgumentParser(description="Export environments based on file paths.")
    parser.add_argument("--input-file", required=True, help="File containing environment paths")
    parser.add_argument("--output-dir", default="export", help="Directory to export environments to")
    parser.add_argument("--project-name", required=True, help="Name of the project folder in the export directory")
    parser.add_argument("--create-tar", action="store_true", help="Create a tarball of the exported environments")
    
    args = parser.parse_args()
    
    export_environments(
        input_file=args.input_file, 
        output_dir=args.output_dir, 
        project_name=args.project_name, 
        create_tar=args.create_tar
    )

if __name__ == "__main__":
    main()