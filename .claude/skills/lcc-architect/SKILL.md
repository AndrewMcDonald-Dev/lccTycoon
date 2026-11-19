---
name: lcc-architect
description: For subagents that design or change the structure of an LCC+ game in the modular template — DESIGN.md and WORKPLAN.md, game.json modules/prefixes/budgets, src/defs.ap constants and record layouts, src/state.ap shared data, the main loop, module stubs with ';;' contracts, and interface-change WPs. Load when the brief is architecture, bootstrap/skeleton (WP0), data-model or API changes.
---

# Architecting an LCC+ game

Your output is what lets several agents work at once without stepping on each other:
stable contracts, one owner per file, a game that builds and runs at every step.

## Deliverables of a skeleton (WP0)

Start from `node tools/lccgame.js new <name> --modular` (or the existing directory), then:

1. `DESIGN.md` from `templates/modular/DESIGN.md`: pitch, in/out of scope, screen layout
   mock-up, controls, data model, memory budget, module list with responsibilities, frame
   loop, open questions.
2. `game.json`: every module file **including `main.ap`** (prefix `main_`) with `prefix` (2–4 letters + `_`, unique), `owner`
   (`architect` or a WP id), `description`, `skills` (domain skill names for the
   orchestrator). `defs.ap` gets `"prefix": []` (no labels allowed). Set `budget.words`.
3. `src/defs.ap`: every shared constant — sizes, record field offsets, tile/entity kinds,
   colors and glyphs specific to the game, key codes, tuning numbers. Defines only.
4. `src/state.ap`: every piece of shared state as labeled data (`st_` prefix), each with a
   one-line comment: units, range, who writes it.
5. `main.ap`: init → loop { input; if not paused: simulation ticks; render; present; sleep }.
6. One stub per module: header with `;;` contract lines, routines that return safely
   (`ret` with r0 = neutral value), so `check` passes and every WP starts from a running game.
7. A unit-driver example for at least one module, and a smoke scenario test for the game.
   Keep smoke assertions stable across later WPs: prefer state (`memory`), frame titles
   from `defs.ap`, and region presence over exact placeholder text; list in WORKPLAN which
   WP will replace each placeholder the smoke test pins.
8. `WORKPLAN.md` from `templates/modular/WORKPLAN.md`: WPs with files owned, dependencies,
   skills, acceptance tests.

Verify with `build --map` (budget) and `check` before handing back.

## Data modeling in LCC

- **Tables of fixed-size records**: `.define GUEST_SIZE 16`, field offsets
  `.define G_X 0`, `.define G_Y 1`, …; storage `st_guests: .zero MAX_GUESTS*GUEST_SIZE`.
  Record address = base + index*SIZE: make SIZE a power of two so `sll r1, 4` replaces
  `mul`. Access fields with `ldr r2, r1, G_X` — offsets must stay ≤ 31 (offset6), so keep
  records ≤ 32 words.
- **Grids**: `.zero MAP_W*MAP_H`, index = y*MAP_W + x; power-of-two width → `sll`.
  Pack tile data into one word with bit fields: `.define T_KIND_MASK 0x001F`,
  `.define T_OWNER_SHIFT 5`… and document every field in defs.ap.
- 16-bit signed math everywhere (−32768..32767). Plan wider quantities explicitly (money:
  see lcc-simulation) and document units (ticks, tenths, cents).
- One shared display block (e.g. 100x30) in `state.ap`; modules draw into agreed regions
  (write the region rectangles as defines: `.define VIEW_ROW 0`, `VIEW_COLS 64`, …).
- No heap: allocate fixed pools with an in-use field; "free" = clear the field.
- Static data that belongs to one module (catalogs, strings, lookup tables) lives in that
  module, not in state.ap.

## Memory budget (64K words total)

Code + static data load at 0x0000 upward; the stack grows down from 0xFFFF. Keep the
program ≤ ~48K words (`budget.words`) to leave room for stack and scratch. Typical costs:
display block 100x30 = 3004 words; 64x40 map = 2560; 128 records × 16 = 2048; code for a
mid-size game 8–20K words. `build --map` shows words per module.

## Contracts

- Every public routine: a `;;` line `;; mod_name  r0=.. r1=.. -> r0=..  effect`, the
  standard convention (args r0..r4, result r0, all else preserved).
- Name side effects on state explicitly ("writes st_cash_lo/hi").
- Internal routines and labels still carry the module prefix (labels are global).

## Changing an interface (an "architect WP")

Add, don't break: add new defines/state cells/routines; keep old ones until every caller
moves. If something must change, list every caller (`grep -n name games/<name>`), update
callers in the same WP only if the brief gives you those files, otherwise record follow-up
WPs. Bump the DESIGN.md data-model section and re-run `check`.

## Decomposing into WPs

One module or feature per WP, 150–500 lines of assembly, independently testable through a
unit driver. Order: skeleton → map/world → rendering + input (parallel) → core simulation
modules (parallel where files are disjoint) → interactions between them → content/tuning →
polish. Write acceptance tests in terms of state (memory) and screen text.
