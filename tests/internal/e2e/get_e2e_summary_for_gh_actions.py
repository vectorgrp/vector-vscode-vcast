import os
import re
import sys

from pathlib import Path


if not len(sys.argv) == 2:
    raise Exception("python get_e2e_summary_for_gh_actions.py <path-to-log-file>")

log_file = Path(sys.argv[1])
if not log_file.is_file():
    raise Exception(f"{log_file} does not exist or is not a file")

REPOSITORY_PATH = str(
    Path(os.path.realpath(__file__)).parent.parent.parent.parent.absolute()
)


def get_link_from_error(text: str) -> str:
    errors = re.findall(
        re.compile(r"^Error: .+?\(.*\)$", flags=re.DOTALL | re.MULTILINE), text
    )
    ret = ""
    for error in errors:
        files = re.findall(
            re.compile(r"(?:Context\.<anonymous>\s*|Error: Timeout of.*)\(([^)]+)\)"),
            error,
        )
        for file in files:
            if ":" in file:
                file_path, line_column = file.split(":", 1)
                line = line_column.split(":")[0]
            else:
                file_path = file
                line = 0
            file_path = file_path.replace(REPOSITORY_PATH + "/", "")
            ret += f'[{file_path}](https://github.com/{os.getenv("GITHUB_REPOSITORY")}/blob/{os.getenv("GITHUB_SHA")}/{file_path}#L{line})\n'
    if ret:
        ret = f"#### Links to source files\n{ret}"
    return ret


logs = log_file.read_text(encoding="utf-8")
specs = re.findall(
    re.compile(r'\s"spec" Reporter:.+?Spec Files:.+?$', flags=re.DOTALL | re.MULTILINE),
    logs,
)
if not specs:
    res = "Specs not found in logs"
else:
    res = ""
    for spec in specs:
        clean_spec = re.compile(r"\x1b[^m]*m").sub("", spec.strip())
        clean_spec = re.sub(
            re.compile(r"^\[.+?\]\s", flags=re.DOTALL | re.MULTILINE), "", clean_spec
        )
        workers_executions = re.split(re.compile(r"-+\n|\nSpec Files:"), clean_spec)[1:]
        final_line = f"Spec Files:{workers_executions.pop(-1)}"
        res += "## Spec\n"
        for execution in workers_executions:
            res += f"```\n{execution.strip()}\n```\n"
            res += get_link_from_error(execution)
        res += f"\n```\n{final_line.strip()}\n```"

with open(f'{Path(log_file.parent, "gh_e2e_summary.md")}', "w", encoding="utf-8") as f:
    f.write(res)
