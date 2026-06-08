# Boundary-Processor VS Code Integration — Plan

VS Code extension feature that drives pyatg's boundary-processor mode
(branch `3285_bp_integration`), replacing the manual `Boundaries.csv`
spreadsheet flow with a webview.

Companion repo: `~/vector/pyatg/3285_bp_integration` (issue #3285).
Pattern reference: the line-test feature on
`vectorgrp/vector-vscode-vcast` branch `atg_line_tst_rebased`.

This branch (`bp_integration`) is based on `origin/main`. The line-test
scaffolding is referenced for patterns but not merged in.

## What the boundary processor does

pyatg gains two CLI flags (defined in `atg/misc/options.py`,
dispatched by `atg/solvers/boundary/__init__.py`):

| Flag | Behaviour |
|---|---|
| `--generate-ranges-sheet <path>` | Walks every routine in the unit, classifies every controllable input (params, globals, stubs, struct fields, function pointers), emits `inputs.xlsx` + `mapping.csv` into the parent dir of `<path>`. |
| `--from-ranges-sheet <dir>` | Reads `inputs.xlsx` + `mapping.csv` from `<dir>` and, if present, a user-authored `Boundaries.csv` next to them. Emits a `.tst` of boundary-value test cases via ATG's regular `TestSuite`. |

`Boundaries.csv` is the human-edited file we want to replace. 8 columns:

```
[0] var_declared_in   source .c file ("%%ROOT%%/foo.c" placeholder)
[1] scope             param | global | call | stub | stub_param
[2] (unused)
[3] expression_name   e.g. "x", "arr[*]", "p[0]", "<<GLOBAL>>.field"
[4] (unused)
[5] boundary_type     "<AUTO_GENERATE>" | "5" | "[10, 20]" | "<until N>"
[6] skip_adjustments  "<FORCE_DISABLED_ADJUSTMENT>" or empty (disables ±1)
[7] bsc_remarks       "Has initialiser; use existing values" skips row
```

`mapping.csv` carries the type annotation in column 9
(`enum:S:32`, `arr:4`, `ptr`, `func:VCAST_ATG_FP_0`, etc.) — that's
what the webview will turn into a sensible editor (dropdown, range
fields, toggle).

## End-to-end thin slice (iteration 1)

One command. No editing yet. Proves the pipeline works.

1. **Right-click** in editor on a `.c`/`.cpp` source file in a built
   VectorCAST environment → **"Generate Boundary Tests for Unit"**.
2. Extension runs **stage 1**:
   ```
   atg --generate-ranges-sheet <tmp>/sheets/sheet.xlsx
   ```
   with `VCAST_ATG_PATH` and the environment set. Outputs land in
   `<tmp>/sheets/{inputs.xlsx, mapping.csv}`.
3. Extension parses `mapping.csv` into a JSON list of input rows and
   opens a **read-only webview** displaying them (file, scope,
   expression, annotation). No edit controls in iteration 1.
4. User clicks **"Generate Tests"** → extension writes a default
   `Boundaries.csv` (every row = `<AUTO_GENERATE>`) into the same dir.
5. Extension runs **stage 2**:
   ```
   atg --from-ranges-sheet <tmp>/sheets
   ```
6. The produced `.tst` is loaded into the environment via
   `clicast -e <ENV> test script run <path>`, mirroring how the
   line-test feature loads its output.
7. Message-pane logs are shown for both stage invocations.

### What "done" looks like for iteration 1

- Command appears in the editor context menu for `.c` and `.cpp` files
  when the workspace has an open VectorCAST environment.
- Both stages run end to end without manual file editing.
- The webview shows the input list (one row per controllable input).
- The generated `.tst` is visible in the testing pane.

### Visual checkpoints I'll ask you to confirm

1. Command shows up in the editor right-click menu after `pnpm
   compile` and a reload (in the VS Code Extension Development Host).
2. The webview opens and shows non-empty rows for a known unit
   (we'll use `atg_testing/test_generation/inputs/boundary/moo.c` or
   similar from the pyatg tree).
3. The `.tst` arrives in the env. Coverage report comes back > 0%.

## Long-term vision

What the user should ultimately see is **only the variables and their
ranges**, with the **source code itself** as the context. The pyatg
annotations (`enum:S:32`, `arr:4`, `ptr`, …) are an implementation
detail of the boundary classifier and should not bleed into the UI.

Concretely, the target shape of the webview is roughly:

```
┌─────────────────────────────┬───────────────────────────────────────┐
│  moo.c (read-only, scrolls) │  Inputs                                │
│                             │                                        │
│   1  struct point {         │   score   [ Auto      ▼ ]              │
│   2    int x;               │   threshold [ Range  ] lo:  hi:        │
│   3    int y;               │   flags    [ Fixed   ] value: 0x01     │
│   4  };                     │   pt.x     [ Auto    ▼ ]               │
│   5                         │   pt.y     [ Auto    ▼ ]               │
│   6  int threshold;         │   arr      ...                         │
│   7                         │   …                                    │
│   8  void moo(int score, …) │                                        │
│   9    if (score > thresh…) │                                        │
└─────────────────────────────┴───────────────────────────────────────┘
```

When the user hovers a variable row, the matching identifier in the
code highlights (and vice versa). The annotation column we currently
display in iteration 1 disappears — the source is the reference.

Iterations below are intermediate steps toward that shape.

## Iteration 2 — scalars-only editor

Adds editing to iteration 1's webview. Scope: scalar-annotated rows
(`enum:S:N`, `enum:U:N`) get a per-row mode selector:

- **Auto** (default) — no override; pyatg autogens
- **Fixed value** — single int field; one boundary value
- **Range `[lo, hi]`** — two int fields; explicit boundary range

Array/pointer/fptr rows stay on Auto for now (greyed-out selector).

A per-row toggle: "Skip ±1 adjustments" (maps to pyatg's
`<FORCE_DISABLED_ADJUSTMENT>` flag in the manual-form inputs row).

Annotation column stays visible in iteration 2 as a diagnostic aid;
hiding it lives behind iteration 3 once we trust the editors.

On submit, write the 8-column manual-form `inputs.csv` (next to the
existing 5-column `inputs.xlsx`) and run stage 2 with the manual flow.

## Iteration 3 — code-as-reference UI

- Two-pane layout: source on the left (read-only, syntax-highlighted),
  inputs list on the right.
- Hover-link between code identifiers and inputs (echoes the line-test
  feature).
- Annotation column hidden by default; available in a "show details"
  toggle for debugging.
- Array / pointer / function-pointer editors land here, driven by
  annotation but presented as code-natural choices.

## Iteration 4+ (beyond MVP)

- Persist the user's edits per-unit in workspace storage so reopening
  shows the last state.
- Diff view between autogen sheets and user-edited.
- Direct import of an existing `*.boundaries.csv` from the project
  source tree.
- Sidebar panel listing all boundary-tested units in the workspace.

## Code layout (proposed)

Following the line-test pattern (which we are not merging, but
mirroring):

```
src/
  bpMode.ts                          ── BPModeManager (per-unit state)
  manage/webviews/
    html/boundaryEditor.html
    css/boundaryEditor.css
    webviewScripts/boundaryEditor.js
src-common/
  (no new files — reuse vcastServer plumbing if needed)
python/
  (no new files — pyatg CLI is shelled out directly)
```

Helpers added to existing files:

- `src/vcastUtilities.ts` — `getBoundarySheetCommand(sourceFile,
  enviroPath, outDir)`, `getBoundaryFromSheetCommand(outDir,
  enviroPath)`, `writeAutoBoundariesCsv(outDir, mappingRows)`.
- `src/vcastCommandRunner.ts` — reuse `executeATGLineForScript`'s spawn
  helper; consider extracting a generic `executeATGCommand`.
- `src/vcastAdapter.ts` — `runBoundaryStageOne(...)` and
  `runBoundaryStageTwo(...)` wrappers.
- `src/extension.ts` — register `vectorcastTestExplorer.bpGenerateForUnit`.
- `package.json` — new command, `editor/context` menu binding for `.c`/`.cpp`.

## pyatg-side reference points

| Concern | File |
|---|---|
| CLI flags | `atg/misc/options.py` (`generate_ranges_sheet`, `from_ranges_sheet`) |
| Dispatch | `atg/solvers/boundary/__init__.py` |
| `inputs.xlsx` / `mapping.csv` schema | `atg/solvers/boundary/support.py:OutputRow` |
| Reader (parses both autogen + manual) | `atg/solvers/boundary/gentst.py:process_xls`, `process_inputs_as_csv` |
| Manual-row parsing | `_proc_manual_row` (gentst.py:2548) |
| Annotation parsing | `atg/solvers/boundary/gentst_support.py:Annotations` |
| Test fixtures | `atg_testing/test_generation/inputs/boundary/*.c` |

## Environment

To run the extension against this pyatg checkout:

```sh
export VCAST_ATG_PATH=$HOME/vector/pyatg/3285_bp_integration/atg/main.py
# (VECTORCAST_DIR must be on PATH; clicast/atg/vpython under it)
```

The extension reads `VCAST_ATG_PATH` from the same setting the
line-test feature added (`vectorcastTestExplorer.atgPath`), falling
back to the env var.

## Open questions / decisions deferred

- Naming of the command: `vectorcastTestExplorer.bpGenerateForUnit`?
  `vectorcastTestExplorer.generateBoundaryTests`? — TBD before
  shipping iteration 1.
- Where the temp sheet directory lives — workspace `.vcast-bp/` vs
  OS temp. Workspace is more discoverable but pollutes the source
  tree; will go with workspace for iteration 1 (under
  `<env>/.bp-sheets/`).
- How to handle multi-unit environments (one webview per unit, or
  one combined view) — deferred to iteration 2.
