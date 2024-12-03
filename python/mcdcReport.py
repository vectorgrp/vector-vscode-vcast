import argparse
import pathlib
import sys

from vector.apps.DataAPI.unit_test_api import UnitTestApi

from pythonUtilities import monkeypatch_custom_css


def parse_args():
    """
    Simple argument parser
    """

    # Create the argument parser
    parser = argparse.ArgumentParser(
        description="Process environment, unit, and line arguments."
    )

    # Add the arguments
    parser.add_argument(
        "-e", "--env", required=True, help="VectorCAST environment to process"
    )
    parser.add_argument("-u", "--unit", help="Unit name (no extension)")
    parser.add_argument("-l", "--line", type=int, help="Line number")
    parser.add_argument("-o", "--output", help="Output location")

    # Parse the arguments
    return parser.parse_args()


def get_mcdc_lines(env):
    all_lines_with_data = {}

    with UnitTestApi(env) as api:
        for unit in api.Unit.filter():
            for mcdc_dec in unit.cover_data.mcdc_decisions:
                if not mcdc_dec.num_conditions:
                    continue
                if unit.name not in all_lines_with_data:
                    all_lines_with_data[unit.name] = []
                if mcdc_dec.start_line not in all_lines_with_data[unit.name]:
                    all_lines_with_data[unit.name].append(mcdc_dec.start_line)

    return all_lines_with_data


def generate_mcdc_report(env, unit, line, output):
    """
    Generates the our custom report for all of the MCDC decisions on a given line (in a given unit, in a given environment).

    File gets written to output
    """

    # Calculate the location of our custom folder
    source_root = pathlib.Path(__file__).parent.resolve()
    custom_dir = source_root / "custom"

    # What's the path to our custom CSS?
    custom_css = custom_dir / "vscode.css"

    # Patch get_option to use our CSS without setting the CFG option
    monkeypatch_custom_css(custom_css)

    # Open-up the unit test API
    with UnitTestApi(env) as api:
        # Find and check for our unit
        unit_found = False
        for unit in api.Unit.filter(name=unit):
            unit_found = True
            print(unit.cover_data)

            # Spin through all MCDC decisions looking for the one on our line
            line_found = False
            for mcdc_dec in unit.cover_data.mcdc_decisions:

                print(mcdc_dec)
                # If it has no conditions, then it generates an empty report
                #
                # TODO: do we want to just generate an empty MCDC report?
                if not mcdc_dec.num_conditions:
                    continue

                # If the line is not the line we're looking for, continue
                if mcdc_dec.start_line != line:
                    continue

                # Mark that we've found our line
                line_found = True

                # Record in the API instance the line number we're interested
                # in
                #
                # NOTE: custom/sections/mini_mcdc.py reads this attribute to
                # know what to filter!
                api.filter_mcdc_dec_line = mcdc_dec.start_line

                # Generate our report
                api.report(
                    report_type="per_line_mcdc_report",
                    formats=["HTML"],
                    output_file=output,
                    customization_dir=custom_dir,
                )
                break

            # If we don't find our line, report an error
            if not line_found:
                raise RuntimeError(f"Could not find line {line}")

        # If we don't find our unit, report an error
        if not unit_found:
            raise RuntimeError(
                f"Could not find unit {unit} (units should not have extensions)"
            )


def main():
    """
    Entry point
    """

    # Calculate the location of our custom folder
    source_root = pathlib.Path(__file__).parent.resolve()
    custom_dir = source_root / "custom"

    # Parse the arguments
    args = parse_args()

    # If only env is defined --> We only want the MCDC lines for that env and not the report
    if not args.unit and not args.line and not args.output:
        mcdc_set = get_mcdc_lines(args.env)
        print(mcdc_set)
    else:
        # Generate the report
        generate_mcdc_report(args.env, args.unit, args.line, args.output)

    # Error handling is via exceptions, so we're all good here
    return 0


if __name__ == "__main__":
    sys.exit(main())

# EOF
