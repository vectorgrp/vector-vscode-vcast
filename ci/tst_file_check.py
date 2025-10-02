import re
import sys
from pathlib import Path


def main():
    errors = []

    tst_file = sys.argv[1] if len(sys.argv) > 1 else None
    if not tst_file:
        errors.append("No tst file provided")

    tst_file = Path(tst_file)
    if not tst_file.exists():
        errors.append(f"File {tst_file} does not exist")

    tst_file_contents = tst_file.read_text(encoding="utf-8")

    to_check = {
        "FR19": [
            "TEST.VALUE:manager.Clear_Table.Table:",
            "TEST.STUB:uut_prototype_stubs.Update_Table_Record",
            "TEST.EXPECTED:uut_prototype_stubs.Update_Table_Record.Data.Number_In_Party:1",
        ]
    }

    tests = re.findall(r"TEST.UNIT:.*?TEST.END\n", tst_file_contents, re.DOTALL)
    tests_dict = {}
    for test_block in tests:
        match = re.search(r"Tested Requirement ID:\s*(\w+)", test_block)
        if not match:
            errors.append(
                f"Test block does not contain 'Tested Requirement ID': {test_block}"
            )
        req_id = match.group(1)
        tests_dict[req_id] = test_block

    for k, lines in to_check.items():
        test_block = tests_dict.get(k)
        if not test_block:
            errors.append(f"Test block for {k} not found")

        for line in lines:
            if line not in test_block:
                errors.append(f"Line '{line}' not found in test block for {k}")

    return errors


if __name__ == "__main__":
    errors = main()
    if errors:
        with open("tst_file_check_errors.txt", "w") as f:
            f.write("\n".join(errors))
        sys.exit(1)
