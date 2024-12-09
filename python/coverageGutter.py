from vTestInterface import MCDCLineCoverage


def getMCDCLineDic(sourceObject):
    """
    Returns a dictionary with the MCDC line coverage for each unit.
    {unit_name: {line_number: MCDCLineCoverage}}
    A line number can have the coverage states: covered, partially covered, uncovered (defined in MCDCLineCoverage).
    """
    mcdc_unit_line_dic = dict()
    temp_line_coverage_dic = dict()
    for mcdc in sourceObject.cover_data.mcdc_decisions:

        # If it s not a mcdc pair --> continue
        if not mcdc.num_conditions:
            continue

        start_line = mcdc.start_line

        # Per default, we set the line to be uncovered
        temp_line_coverage_dic[start_line] = MCDCLineCoverage.uncovered
        mcdc_unit_line_dic[sourceObject.unit_name] = temp_line_coverage_dic

        covered_mcdc_found = False
        uncovered_mcdc_found = False

        for row in mcdc.rows:
            if row.has_any_coverage != 0:
                covered_mcdc_found = True
            else:
                uncovered_mcdc_found = True

        if covered_mcdc_found == True:
            # We found covered and uncovered mcdc pairs --> Partially covered
            if uncovered_mcdc_found == True:
                temp_line_coverage_dic[start_line] = MCDCLineCoverage.partially_covered
            else:
                # We found only covered mcdc pairs --> Fully covered
                temp_line_coverage_dic[start_line] = MCDCLineCoverage.covered

    return mcdc_unit_line_dic


def handleMcdcCoverage(
    sourceObject,
    mcdc_line_dic,
    line,
    coveredString,
    partiallyCoveredString,
    uncoveredString,
):
    metrics = line.metrics

    line_number = line.line_number

    # Since we only have mcdc lines and not statements, we first need to check whether our unit is in the dic first
    unit_mcdc_lines = mcdc_line_dic.get(sourceObject.unit_name, {})
    mcdc_line_coverage = unit_mcdc_lines.get(line_number, None)

    if mcdc_line_coverage is not None:
        has_branch_coverage = (
            metrics.max_covered_branches > 0 or metrics.max_annotations_branches > 0
        )
        # First check for the branch coverage. If it has none, it can not be partially covered / covered
        if has_branch_coverage:
            mcdc_line_coverage = mcdc_line_dic[sourceObject.unit_name].get(
                line_number, MCDCLineCoverage.uncovered
            )

            # To be fully mcdc covered: All Branches + All MCDC pairs
            is_fully_mcdc_covered = (
                metrics.max_covered_branches + metrics.max_annotations_branches
                == metrics.branches
                and mcdc_line_coverage == MCDCLineCoverage.covered
            )
            # If it's fully covered --> It's an mcdc line and fully covered --> green
            if is_fully_mcdc_covered:
                coveredString += f"{line.line_number},"
            # Partially covered mcdc line --> orange
            elif mcdc_line_coverage == MCDCLineCoverage.partially_covered:
                partiallyCoveredString += f"{line.line_number},"
            # If it has branches covered but not mcdc pair
            else:
                uncoveredString += f"{line.line_number},"

        # It has no branch coverage but there are branches --> uncovered
        elif metrics.branches > 0:
            uncoveredString += str(line.line_number) + ","

    return coveredString, partiallyCoveredString, uncoveredString


def handleStatementMcdcCoverage(
    sourceObject,
    mcdc_line_dic,
    line,
    coveredString,
    partiallyCoveredString,
    uncoveredString,
):
    metrics = line.metrics
    line_number = line.line_number

    has_coverage = (
        metrics.max_covered_statements > 0 or metrics.max_annotations_statements > 0
    )

    # Check if it s an uncovered statement
    if has_coverage:

        # Check if the unit is in the dic
        unit_mcdc_lines = mcdc_line_dic.get(sourceObject.unit_name, {})
        mcdc_line_coverage = unit_mcdc_lines.get(line_number, None)

        if mcdc_line_coverage is not None:
            mcdc_line_coverage = mcdc_line_dic[sourceObject.unit_name].get(
                line_number, MCDCLineCoverage.uncovered
            )

            # To be fully mcdc covered: All Statements + All Branches + All MCDC pairs
            is_fully_mcdc_covered = (
                metrics.max_covered_statements + metrics.max_annotations_statements
                == metrics.statements
                and metrics.max_covered_branches + metrics.max_annotations_branches
                == metrics.branches
                and mcdc_line_coverage == MCDCLineCoverage.covered
            )

            # If it's fully covered --> It's an mcdc line and fully covered --> green
            if is_fully_mcdc_covered:
                coveredString += f"{line.line_number},"
            # Partially covered mcdc line --> orange
            elif mcdc_line_coverage == MCDCLineCoverage.partially_covered:
                partiallyCoveredString += f"{line.line_number},"
            # a mcdc line that has no coverage --> Red
            else:
                uncoveredString += f"{line.line_number},"

        # It's a fully covered statement and not a mcdc line --> green
        elif (
            metrics.max_covered_statements + metrics.max_annotations_statements
            == metrics.statements
        ):
            coveredString += str(line.line_number) + ","

    # If it s no mcdc line is not covered but still has statements --> uncovered statement line --> red
    elif metrics.statements > 0:
        uncoveredString += str(line.line_number) + ","

    return coveredString, partiallyCoveredString, uncoveredString


def main():
    pass


if __name__ == "__main__":
    main()
