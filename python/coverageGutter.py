class MCDCLineCoverage:
    covered = 0
    partially_covered = 1
    uncovered = 2


def getMCDCLineDic(sourceObject):
    """
    Returns a dictionary with the MCDC line coverage for each unit.
    {unit_name: {line_number: MCDCLineCoverage}}
    A line number can have the coverage states: covered, partially covered, uncovered (defined in MCDCLineCoverage).
    """
    mcdc_unit_line_dic = dict()
    temp_line_coverage_dic = dict()

    unitFile = sourceObject.cover_data.name
    unit = unitFile.rsplit(".", 1)[0]
    for mcdc in sourceObject.cover_data.mcdc_decisions:

        # If it s not a mcdc pair --> continue
        if not mcdc.num_conditions:
            continue

        start_line = mcdc.start_line

        # Per default, we set the line to be uncovered
        temp_line_coverage_dic[start_line] = MCDCLineCoverage.uncovered
        mcdc_unit_line_dic[unit] = temp_line_coverage_dic

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


def handleStatementCoverage(
    line, coveredString, partiallyCoveredString, uncoveredString
):
    """
    Returns the coverage strings for Statement Coverage.
    """
    metrics = line.metrics
    if metrics.max_covered_statements > 0 or metrics.max_annotations_statements > 0:
        coveredString += str(line.line_number) + ","
    elif metrics.statements > 0:
        uncoveredString += str(line.line_number) + ","

    return coveredString, uncoveredString


def handleMcdcCoverage(
    unit,
    mcdc_line_dic,
    line,
    coveredString,
    partiallyCoveredString,
    uncoveredString,
):
    """
    Returns the coverage strings for MCDC Coverage.
    """
    metrics = line.metrics
    line_number = line.line_number

    # Since we only have mcdc lines and not statements, we first need to check whether our unit is in the dic first
    unit_mcdc_lines = mcdc_line_dic.get(unit, {})
    mcdc_line_coverage = unit_mcdc_lines.get(line_number, None)

    if mcdc_line_coverage is not None:
        has_branch_coverage = (
            metrics.max_covered_branches > 0 or metrics.max_annotations_branches > 0
        )
        # First check for the branch coverage. If it has none, it can not be partially covered / covered
        if has_branch_coverage:
            mcdc_line_coverage = mcdc_line_dic[unit].get(
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
    unit,
    mcdc_line_dic,
    line,
    coveredString,
    partiallyCoveredString,
    uncoveredString,
):
    """
    Returns the coverage strings for Statement + MCDC Coverage.
    """
    metrics = line.metrics
    line_number = line.line_number

    has_coverage = (
        metrics.max_covered_statements > 0 or metrics.max_annotations_statements > 0
    )

    # Check if it s an uncovered statement
    if has_coverage:

        # Check if the unit is in the dic
        unit_mcdc_lines = mcdc_line_dic.get(unit, {})
        mcdc_line_coverage = unit_mcdc_lines.get(line_number, None)

        if mcdc_line_coverage is not None:
            mcdc_line_coverage = mcdc_line_dic[unit].get(
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


def handleStatementBranchCoverage(
    line,
    coveredString,
    partiallyCoveredString,
    uncoveredString,
):
    """
    Returns the coverage strings for Statement + Branch Coverage.
    """
    metrics = line.metrics
    if metrics.max_covered_statements > 0 or metrics.max_annotations_statements > 0:
        # Check if it's a branch line
        if metrics.branches > 0:
            # If every branch is covered --> green
            if (
                metrics.max_covered_branches + metrics.max_annotations_branches
                == metrics.branches
            ):
                coveredString += str(line.line_number) + ","

            # If only a part of the branch is covered --> orange
            elif metrics.max_covered_branches + metrics.max_annotations_branches > 0:
                partiallyCoveredString += str(line.line_number) + ","

            # If it s a branch but nothing is covered --> red
            else:
                uncoveredString += str(line.line_number) + ","

        # It's not a branch line but a fully covered statement line --> green
        elif (
            metrics.max_covered_statements + metrics.max_annotations_statements
            == metrics.statements
        ):
            coveredString += str(line.line_number) + ","

    # It's a statement line but not covered --> red
    elif metrics.statements > 0:
        uncoveredString += str(line.line_number) + ","

    return coveredString, partiallyCoveredString, uncoveredString


def handleBranchCoverage(
    line,
    functionLineList,
    coveredString,
    partiallyCoveredString,
    uncoveredString,
):
    """
    Returns the coverage strings for Branch Coverage.
    """
    metrics = line.metrics
    line_number = line.line_number

    # Check if it's a branch line and filter out function lines
    if metrics.branches > 0 and line_number not in functionLineList:
        # If every branch is covered --> green
        if (
            metrics.max_covered_branches + metrics.max_annotations_branches
            == metrics.branches
        ):
            coveredString += str(line_number) + ","

        # If only a part of the branch is covered --> orange
        elif metrics.max_covered_branches + metrics.max_annotations_branches > 0:
            partiallyCoveredString += str(line_number) + ","

        # If it s a branch but nothing is covered --> red
        else:
            uncoveredString += str(line_number) + ","

    return coveredString, partiallyCoveredString, uncoveredString


def main():
    pass


if __name__ == "__main__":
    main()
