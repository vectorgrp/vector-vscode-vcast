#!/usr/bin/env vpython
"""Map VectorCAST/Ada coverage back onto subunit ("separate") source files.

VectorCAST concatenates a unit's body with its subunits before instrumenting, so
DataAPI reports one SourceFile and statement line numbers in the coordinate space
of that concatenation. Instrumentation inserts lines, so the shift between the
concatenation and any real file is not constant and cannot be undone with an
offset. This recovers the mapping by aligning the LIS listing's source text
against the real files, and reports coverage per real file and real line.

Usage:
    $VECTORCAST_DIR/vpython separate_coverage.py <environment-dir> [--all]
"""

import argparse
import difflib
import os
import re
import sys

# NOTE: the DataAPI import is intentionally deferred to collect() (the only
# caller that needs it). The listing<->source alignment functions above it are
# pure Python, so keeping this out of module import scope lets them be unit
# tested with a plain python3, without a VectorCAST installation.

# Written ahead of each appended subunit by APPEND_SEPARATES (vcast/utilities.adb).
# The env keeps its copies; the LIS listing does not.
MARKER = "--VCAST_FILENAME_"


def normalize(line):
    return re.sub(r"\s+", " ", (line or "").strip()).lower()


def read_lines(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        return handle.read().splitlines()


def find_separate_sources(env_dir):
    """Original paths of subunits, taken from the VCAST_FILENAME markers.

    Depending on the VectorCAST version/options the markers are written either
    as the first line of individual subunit copies in the env, or interspersed
    inside the concatenated harness file (e.g. P*.ADA / cover_temp.txt) ahead of
    each appended subunit. We scan the contents of the candidate files so both
    layouts are handled, and de-duplicate the referenced original paths.
    """
    found = []
    seen = set()
    for name in sorted(os.listdir(env_dir)):
        if not name.lower().endswith((".adb", ".ads", ".ada", ".txt")):
            continue
        try:
            with open(
                os.path.join(env_dir, name), encoding="utf-8", errors="replace"
            ) as handle:
                for line in handle:
                    if not line.startswith(MARKER):
                        continue
                    original = line[len(MARKER) :].strip()
                    real = os.path.realpath(original)
                    if real not in seen and os.path.isfile(real):
                        seen.add(real)
                        found.append(real)
        except OSError:
            continue
    return found


def read_lis(unit):
    """Physical LIS line -> source text, and coverage index -> physical line."""
    text_by_line = {}
    line_by_index = {}
    for physical, data in enumerate(
        unit.sourcefile.cover_data.lis_file.iterate_coverage(), start=1
    ):
        text_by_line[physical] = str(data.lis_line_source_only or "")
        if data.index is not None:
            line_by_index[tuple(data.index)] = physical
    return text_by_line, line_by_index


# A subunit body opens with `separate (Parent)` at the start of a line. The
# parent's own `... is separate;` declarations do not match: they start with
# `function`/`procedure`/`package`.
SEPARATE_RE = re.compile(r"^\s*separate\s*\(", re.IGNORECASE)


def segment_lis(lis_text):
    """Split the glued listing into (start, end) segments at each subunit.

    The listing is the parent body followed by its subunits, so the `separate`
    lines are exact segment boundaries. Lengths cannot be used instead: the
    listing carries blank lines where instrumentation regions were stripped, so
    a segment is longer than the file it came from, by a varying amount.
    """
    total = max(lis_text)
    boundaries = [n for n in sorted(lis_text) if SEPARATE_RE.match(lis_text[n])]
    if not boundaries:
        return [(1, total)]

    segments = []
    if boundaries[0] > 1:
        segments.append((1, boundaries[0] - 1))  # the parent body
    for position, start in enumerate(boundaries):
        following = boundaries[position + 1] if position + 1 < len(boundaries) else None
        segments.append((start, (following - 1) if following else total))
    return segments


def align_segment(lis_text, segment, path):
    """Map a single segment's LIS lines onto one file. Returns (mapping, score)."""
    start, end = segment
    lis_norm = [normalize(lis_text[n]) for n in range(start, end + 1)]
    file_norm = [normalize(line) for line in read_lines(path)]

    matcher = difflib.SequenceMatcher(None, lis_norm, file_norm, autojunk=False)
    mapping, score = {}, 0
    for lis_offset, file_offset, size in matcher.get_matching_blocks():
        for step in range(size):
            if lis_norm[lis_offset + step]:  # ignore blank-line matches
                mapping[start + lis_offset + step] = file_offset + step + 1
                score += 1
    return mapping, score


def align(lis_text, parent, subunits):
    """Map physical LIS line -> (path, line number).

    Each segment is matched against a single file, so lines cannot be
    misattributed between two subunits that happen to share source text.
    """
    mapping, warnings = {}, []
    pool = list(subunits)

    for segment in segment_lis(lis_text):
        is_parent = segment[0] == 1 and not SEPARATE_RE.match(lis_text[1])
        if is_parent:
            candidates = [parent]
        elif pool:
            candidates = pool
        else:
            warnings.append("no source found for listing lines %d-%d" % segment)
            continue

        scored = [(align_segment(lis_text, segment, path), path) for path in candidates]
        # Break score ties on the path so two subunits that align equally well
        # to a segment always resolve to the same one, run to run.
        (best, score), path = max(scored, key=lambda item: (item[0][1], item[1]))
        if not score:
            warnings.append(
                "could not match listing lines %d-%d to any source" % segment
            )
            continue
        if not is_parent:
            pool.remove(path)

        for line, number in best.items():
            mapping[line] = (path, number)
    return mapping, warnings


def decision_real_line(decision, lis_text, line_by_index, mapping, file_cache):
    """Find the (path, line) of a decision in the real source.

    The MC/DC listing splits a decision across physical lines (e.g. `if` on one
    line, `R = 0.0 then` on the next), so no single listing line aligns to the
    one real source line. But their concatenation does, so we grow the source
    text from the decision's first listing line and match it against the real
    file.

    We anchor on the nearest already-mapped listing line, which gives both the
    file the decision is in AND an expected real line near where the surrounding
    code aligned. Among all text matches we then pick the one closest to that
    expected line, so a decision whose text appears more than once in a file
    (e.g. two identical `if A and B then`) resolves to the right occurrence
    rather than always the first from the top.
    """
    physical = line_by_index.get(tuple(decision.lis_index))
    if physical is None:
        return None

    # Nearest mapped listing line (including this one, if mapped) fixes the file
    # and an expected real line. Listing spacing is ~1:1 with the source near the
    # anchor, so the estimate is only approximate - the nearest-match below
    # tolerates the drift.
    before = [p for p in mapping if p <= physical]
    after = [p for p in mapping if p >= physical]
    if before:
        anchor = max(before)
    elif after:
        anchor = min(after)
    else:
        return None
    path, anchor_line = mapping[anchor]
    expected = anchor_line + (physical - anchor)

    if path not in file_cache:
        file_cache[path] = [normalize(line) for line in read_lines(path)]
    file_norm = file_cache[path]

    accumulated = ""
    for step in range(6):  # decisions rarely span more than a few listing lines
        accumulated = normalize(accumulated + " " + lis_text.get(physical + step, ""))
        if not accumulated:
            continue
        best = None
        for index, source in enumerate(file_norm):
            if source and source == accumulated:
                candidate = index + 1
                if best is None or abs(candidate - expected) < abs(best - expected):
                    best = candidate
        if best is not None:
            return path, best
    return None


def mcdc_state(decision, statement_covered):
    """Coverage state for an MC/DC decision line.

    MC/DC is measured in independence PAIRS (max_num_conditions_with_covered_pair
    of num_conditions), matching coverageGutter.getMCDCLineDic and the per-line
    report. MC/DC is not condition coverage: a decision that never completed an
    independence pair has achieved 0% MC/DC and is uncovered, even if some of its
    conditions were exercised. Some-but-not-all pairs is partial; all pairs is
    covered. A decision whose statement never executed is uncovered.
    """
    if statement_covered is False:
        return "uncovered"
    covered_pairs = decision.max_num_conditions_with_covered_pair
    total_pairs = decision.num_conditions
    if covered_pairs <= 0:
        return "uncovered"
    if covered_pairs < total_pairs:
        return "partial"
    return "covered"


def branch_outcomes(branch):
    """(total, covered) branch outcomes for one Branch object.

    Mirrors how DataAPI's per-line metrics count branches. A normal two-way
    decision (single_condition_value == -1) contributes both outcomes; a branch
    that can only ever go one way - e.g. a function-entry probe, or a constant
    condition - contributes just that reachable outcome (single_condition_value
    is 1 for the true side, 0 for the false side). Aggregate coverage (all tests
    combined) and manual annotations both count as covered, matching
    coverageGutter.handleStatementBranchCoverage.
    """
    scv = branch.single_condition_value
    true_covered = (
        1
        if (
            branch.true_covered(aggregate=True) or branch.max_annotations_true_count > 0
        )
        else 0
    )
    false_covered = (
        1
        if (
            branch.false_covered(aggregate=True)
            or branch.max_annotations_false_count > 0
        )
        else 0
    )
    if scv == -1:
        return 2, true_covered + false_covered
    if scv == 1:
        return 1, true_covered
    if scv == 0:
        return 1, false_covered
    return 0, 0


def branch_state(covered, total):
    """Coverage state for a branch/decision line: all/some/none of its outcomes."""
    if covered >= total:
        return "covered"
    if covered > 0:
        return "partial"
    return "uncovered"


def coverage_flags(api):
    """(do_statements, do_branch, do_mcdc, branch_only) for the env's type.

    Boils the coverage type down to which reverse-engineering passes to run, the
    same way vTestInterface.getCoverageKind dispatches getCoverageData to the
    matching coverageGutter handler. MC/DC and Branch are mutually exclusive in
    the object model (an MC/DC env exposes decisions and no branches, and vice
    versa), but we still gate explicitly so each env is treated like its non-Ada
    counterpart.
    """
    text = (getattr(api.environment, "coverage_type_text", "") or "").lower()
    do_mcdc = "mc/dc" in text or "mcdc" in text
    do_branch = ("branch" in text) and not do_mcdc
    # Statements are painted only when the coverage type has a statement
    # component; pure "Branch" / "MC/DC" paint only their decision lines, exactly
    # like coverageGutter.handleBranchCoverage / handleMcdcCoverage.
    do_statements = "statement" in text
    branch_only = do_branch and not do_statements
    return do_statements, do_branch, do_mcdc, branch_only


def subunit_coverage(api, env_dir, include_all=False):
    """Map coverage back onto the real subunit files, reusing an open api.

    Returns {real_path: {line_number: (subprogram, state, hits, source)}} where
    state is "covered" | "partial" | "uncovered". "partial" occurs on MC/DC
    decision lines with some-but-not-all condition pairs covered, and on branch
    lines with some-but-not-all outcomes taken. Which passes run depends on the
    environment's coverage type (statement / branch / MC/DC), matching the
    handler vTestInterface.getCoverageData would use for a non-subunit file.
    Returns {} for non-Ada environments. Warnings go to stderr so they never
    contaminate a caller that parses stdout (e.g. vTestInterface).
    """
    if not getattr(api.environment, "is_ada", False):
        return {}

    do_statements, do_branch, do_mcdc, branch_only = coverage_flags(api)

    subunits = find_separate_sources(env_dir)
    # No "separate" subunits -> nothing to remap; skip the listing alignment.
    if not subunits:
        return {}
    results = {}

    for unit in api.Unit.filter(is_uut=True):
        try:
            unit.load_coverage()
        except Exception:
            pass
        parent = unit.sourcefile.path if unit.sourcefile else None
        if not parent or not os.path.isfile(parent):
            continue

        cover = unit.sourcefile.cover_data
        lis_text, line_by_index = read_lis(unit)
        mapping, warnings = align(lis_text, os.path.realpath(parent), subunits)
        for warning in warnings:
            print("warning: %s: %s" % (unit.name, warning), file=sys.stderr)

        def keep(physical):
            if physical is None or physical not in mapping:
                return None
            path, number = mapping[physical]
            if not include_all and os.path.realpath(path) not in subunits:
                return None
            return path, number

        # Pass 1: statement coverage (index -> physical LIS line -> real file).
        # Skipped for pure-Branch environments, which paint only decision lines.
        if do_statements:
            for function in unit.all_functions:
                for statement in function.statements:
                    target = keep(line_by_index.get(tuple(statement.lis_index)))
                    if target is None:
                        continue
                    path, number = target
                    covered = bool(statement.covered(aggregate=True))
                    results.setdefault(path, {})[number] = (
                        function.name,
                        "covered" if covered else "uncovered",
                        statement.max_hit_count,
                        lis_text[line_by_index[tuple(statement.lis_index)]].strip(),
                    )

        # Pass 2: overlay MC/DC. A decision's pair coverage lives on the
        # MCDCDecision; its listing lines don't align 1:1 to the source, so we
        # reconstruct the real (path, line) and combine with the statement state
        # already recorded for that line.
        if do_mcdc:
            file_cache = {}
            for decision in cover.mcdc_decisions:
                if not decision.num_conditions:
                    continue
                target = decision_real_line(
                    decision, lis_text, line_by_index, mapping, file_cache
                )
                if target is None:
                    continue
                path, number = target
                if not include_all and os.path.realpath(path) not in subunits:
                    continue
                existing = results.get(path, {}).get(number)
                statement_covered = (
                    None if existing is None else (existing[1] == "covered")
                )
                state = mcdc_state(decision, statement_covered)
                if existing is not None:
                    function, _, hits, text = existing
                else:
                    function, hits = "", 0
                    text = (
                        read_lines(path)[number - 1].strip()
                        if os.path.isfile(path)
                        else ""
                    )
                results.setdefault(path, {})[number] = (function, state, hits, text)

        # Pass 3: overlay branch coverage. Branch outcomes live on Branch
        # objects, aggregated per real line, mirroring coverageGutter's
        # handleStatementBranchCoverage / handleBranchCoverage.
        if do_branch:
            file_cache = {}
            per_line = {}  # (path, number) -> [total_outcomes, covered_outcomes]
            for branch in cover.branches:
                target = decision_real_line(
                    branch, lis_text, line_by_index, mapping, file_cache
                )
                if target is None:
                    continue
                path, number = target
                if not include_all and os.path.realpath(path) not in subunits:
                    continue
                total, covered = branch_outcomes(branch)
                if total <= 0:
                    continue
                agg = per_line.setdefault((path, number), [0, 0])
                agg[0] += total
                agg[1] += covered

            for (path, number), (total, covered) in per_line.items():
                existing = results.get(path, {}).get(number)
                if branch_only:
                    # Pure Branch: every decision line is painted by its
                    # outcomes; there is no statement state to gate on.
                    if existing is not None:
                        function, _, hits, text = existing
                    else:
                        function, hits = "", 0
                        text = (
                            read_lines(path)[number - 1].strip()
                            if os.path.isfile(path)
                            else ""
                        )
                    results.setdefault(path, {})[number] = (
                        function,
                        branch_state(covered, total),
                        hits,
                        text,
                    )
                else:
                    # Statement+Branch: only decision lines that also carry
                    # statement coverage are reclassified by their branch
                    # outcomes; a bare branch (e.g. the function-entry probe on
                    # `begin`) or an unexecuted line keeps its statement state.
                    if existing is None or existing[1] != "covered":
                        continue
                    function, _, hits, text = existing
                    results[path][number] = (
                        function,
                        branch_state(covered, total),
                        hits,
                        text,
                    )
    return results


def mcdc_decision_map(api, env_dir):
    """Map each MC/DC decision to both its merged and real coordinates.

    Returns a list of dicts, each with:
        unit        - the (merged) unit name, for the report engine
        merged_line - the decision's start line in the merged listing
        real_path   - the real source file (subunit or parent body)
        real_line   - the decision's line in that real file

    Used to (a) report MC/DC gutter lines on the real subunit files and (b) turn
    a click on a real (file, line) back into the merged unit+line the report
    engine expects. Returns [] for non-Ada / non-subunit environments.
    """
    if not getattr(api.environment, "is_ada", False):
        return []
    if not os.path.isdir(env_dir) and env_dir.lower().endswith(".vce"):
        env_dir = env_dir[:-4]

    subunits = find_separate_sources(env_dir)
    if not subunits:
        return []

    entries = []
    for unit in api.Unit.filter(is_uut=True):
        try:
            unit.load_coverage()
        except Exception:
            pass
        sf = unit.sourcefile
        if not sf or not sf.cover_data or not sf.path or not os.path.isfile(sf.path):
            continue

        lis_text, line_by_index = read_lis(unit)
        mapping, _ = align(lis_text, os.path.realpath(sf.path), subunits)
        file_cache = {}
        for decision in sf.cover_data.mcdc_decisions:
            if not decision.num_conditions:
                continue
            target = decision_real_line(
                decision, lis_text, line_by_index, mapping, file_cache
            )
            if target is None:
                continue
            path, line = target
            entries.append(
                {
                    "unit": unit.name,
                    "merged_line": decision.start_line,
                    "real_path": path,
                    "real_line": line,
                }
            )
    return entries


def collect(env_dir, include_all):
    from vector.apps.DataAPI.unit_test_api import UnitTestApi

    with UnitTestApi(env_dir) as api:
        if not api.environment.is_ada:
            sys.exit("error: %s is not an Ada environment" % env_dir)
        return subunit_coverage(api, env_dir, include_all)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", help="built environment directory")
    parser.add_argument(
        "--all", action="store_true", help="include the parent body, not just subunits"
    )
    args = parser.parse_args()

    results = collect(args.environment, args.all)
    if not results:
        print("No subunit coverage found. Has the environment been executed?")
        return 1

    markers = {"covered": "", "partial": "<-- PARTIAL", "uncovered": "<-- UNCOVERED"}
    exit_code = 0
    for path in sorted(results):
        rows = results[path]
        covered = sum(1 for row in rows.values() if row[1] == "covered")
        print("\n%s  [%d/%d covered]" % (path, covered, len(rows)))
        print("  line  hits  subprogram      source")
        for number in sorted(rows):
            name, state, hits, text = rows[number]
            if state != "covered":
                exit_code = 1
            print(
                "  %4d  %4d  %-14s  %s %s"
                % (number, hits, name, text, markers.get(state, ""))
            )
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
