import os
import sys
import json
import argparse
from pathlib import Path


try:
    SERVER_URL = os.environ["GITHUB_SERVER_URL"]
    REPOSITORY = os.environ["GITHUB_REPOSITORY"]
    COMMIT_SHA = os.environ["GITHUB_SHA"]
except KeyError as e:
    print(f"Error: Missing required environment variable {e}.")
    sys.exit(1)

BASE_URL = f"{SERVER_URL}/{REPOSITORY}/blob/{COMMIT_SHA}"


def parse_pyright_output(pyright_output: Path, output_dir: Path):
    """
    Parse the Pyright output JSON file and generate markdown output.
    """
    root_dir = str(Path(__file__).parent.parent.absolute())

    with open(pyright_output, "r") as f:
        data = json.load(f)

    md_lines = ["## Pyright Output", "### Issues"]
    if not data.get("generalDiagnostics"):
        md_lines.append("No issues found.")
    else:
        for issue in data["generalDiagnostics"]:
            f_name = issue["file"]
            message = issue["message"]
            relative_path = os.path.relpath(f_name, root_dir)
            file_url = f'{BASE_URL}/{relative_path}#L{int(issue["range"]["start"]["line"]) + 1}'

            md_lines.append(f"- [{relative_path}]({file_url}): {message}")

    md_lines.append("### Summary")
    for k, v in data.get("summary", {}).items():
        md_lines.append(f"- {k}: {v}")

    with open(output_dir / "pyright_output.md", "w") as f:
        f.write("\n".join(md_lines) + "\n")


def cli():
    parser = argparse.ArgumentParser(
        description="Parse Pyright output and generate markdown output."
    )
    parser.add_argument(
        "pyright_output", type=Path, help="Path to the Pyright output json file"
    )
    parser.add_argument(
        "--output_dir",
        type=Path,
        help="Directory to save the parsed JSON files",
        default=Path("."),
        required=False,
    )
    args = parser.parse_args()

    pyright_output = args.pyright_output
    if not pyright_output.exists():
        raise FileNotFoundError(f"Pyright output file {pyright_output} does not exist.")
    output_dir = args.output_dir
    if not output_dir.is_dir():
        output_dir.mkdir(parents=True, exist_ok=True)

    parse_pyright_output(args.pyright_output, args.output_dir)


if __name__ == "__main__":
    cli()
