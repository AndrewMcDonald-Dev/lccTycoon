---
name: lcc-simulation
description: For subagents that write game logic in LCC+ assembly — entity pools and state machines, agent needs/decisions, economy and money arithmetic beyond 16 bits, calendars and tick scheduling, random events, grid pathfinding (BFS / distance fields), and keeping it all within the per-frame instruction budget. Load for simulation, AI, economy, pathfinding or other numeric work packages.
---

# Simulation in LCC+ assembly

Everything is 16-bit signed (−32768..32767), there are 5 scratch registers (r0–r4), no
heap and no floating point. Simulations that work here are table-driven, integer, and
time-sliced.

## Ticks and scheduling

- The main loop runs one frame per `sleep` (e.g. 50 ms). Keep a frame counter in state and
  derive slower clocks from it: `ld r0, st_frame` / `and r0, r0, 15` / `brnz skip` runs
  every 16th frame (imm5 ≤ 15 — use a register for larger masks).
- **Time-slice big populations**: update entities `i ≡ frame (mod K)` each frame instead of
  all of them; the cost per frame drops K-fold and behavior stays smooth.
- Calendar: ticks → day → month → year cells in state, advanced by one routine; other
  modules react to "new day"/"new month" flags it sets for one frame.
- Pausing = skip the simulation calls, keep rendering and input.

## Entity pools and state machines

Records are fixed-size (`*_SIZE` power of two ≤ 32 words), fields via `ldr/str rX, rBase,
FIELD`. A `STATE` field of 0 means the slot is free; spawning scans for a free slot.
Dispatch on state with a jump table instead of compare chains:

```
        ldr r1, r4, G_STATE        ; r4 = record address
        lea r2, gst_state_table
        add r2, r2, r1
        ldr r2, r2, 0
        jmp r2                     ; each handler ends with: br gst_next
gst_state_table: .word gst_st_free
        .word gst_st_walking
        .word gst_st_queueing
```

(Handlers reached by `jmp` must not `ret`; branch back to the loop. Keep `lr` saved if the
loop body calls subroutines.)

## Randomness

`rand dr, sr` returns a number in [dr, sr] **into dr** — reload the minimum before every
call. Percent chance: `mov r0, 1` / `mov r1, 100` / `rand r0, r1` / `cmp r0, r2` (r2 =
percent) / `brlt hit` … plus `bre hit`. Seeded once at startup from `millis`; under the
harness the clock is virtual, so tests are deterministic — pin exact outcomes with a fixed
`clock` in the scenario, and test RNG-independent properties (bounds, totals) where you can.

## Numbers

- Meters (hunger, happiness, …): 0..255 or 0..1000; clamp after every change with
  `util_min/util_max` or explicit compares. Store tuning constants (decay rates,
  thresholds, prices) as `.define`s in `defs.ap`.
- `mul dr, sr` / `div` / `rem` are 16-bit signed: check that products stay < 32768; guard
  every divisor against 0 (division by zero halts the program).
- **Money beyond $32,767**: store as two words, thousands + units (`st_cash_k`,
  `st_cash_u` with `0 ≤ u ≤ 999`): add units, then while `u ≥ 1000` subtract 1000 and add 1
  to thousands (borrow likewise on subtraction). Printing is `k` then `u` zero-padded to 3
  (`util_print_padded` with '0', or `video_num` + manual padding). Compare by thousands
  first. (A true 32-bit pair with carry also works: `add` sets C on unsigned overflow and
  `brc` tests it, but decimal printing is much harder.)
- Percentages/ratios: scale to integers (rating 0..1000); fixed-point tenths where needed.

## Pathfinding on grids

- **Distance field (BFS)** from a target set (e.g. all entrances of one attraction) over
  walkable tiles: a `.zero MAP_W*MAP_H` distance array, a ring-buffer queue (`.zero` of
  the same size), 4-neighbor expansion. Cost ≈ 30–60 instructions per tile → ~150K for a
  64x40 map. Recompute only when the map changes or the target set changes (a dirty flag
  in state), not every frame.
- Agents move by stepping to the neighbor with the smallest distance (ties broken by RNG
  for natural crowds). Many agents share one field.
- Limit fields held at once (memory: one word per tile each); for many destinations use
  one BFS per destination *category*, or BFS on demand for a single agent and cache the
  next step.
- Random walks on paths need dead-end handling: prefer not to reverse direction unless no
  other walkable neighbor exists.

## Budgets and profiling

The fast player executes ~100M instructions/s → at 20 fps you have ~5M per frame, but aim
for ≤ 2M so frames stay smooth on slower machines. Measure with
`node tools/lccgame.js run games/<g> --keys "_100" --profile` and add
`maxStepsPerFrame` to a scenario test so regressions are caught.

## Testing simulation code

Unit drivers set up state directly (store into `st_*` cells), call the tick routine N
times (one `sleep` per iteration so frames are counted), then halt; the test checks memory.
Test invariants: pool counts never exceed MAX, meters stay in range, money is conserved
(income − costs = Δcash), entities only stand on walkable tiles.
