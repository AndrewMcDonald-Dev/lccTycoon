# Park Builder — work plan

Owner: orchestrator. Update after every dispatch and hand-back.
Status: `todo | active | review | done | blocked`. A WP may start when its dependencies are
`done`, its files don't overlap an `active` WP, and every routine it calls exists (stub ok).
Every WP's skills list adds `lcc-game-dev`, `lccplus-assembly` and `lccjs-assembly` to the
domain skill shown.

| WP | Title | Owns (files) | Depends | Domain skill | Wave | Status |
|----|-------|--------------|---------|--------------|------|--------|
| WP0 | Walking skeleton + data model | game.json, main.ap, src/defs.ap, src/state.ap, stubs of all modules, tests/smoke.test.json | — | lcc-architect | 0 | done |
| WP1 | World & map | src/map.ap, tests/unit/map_* | WP0 | lcc-simulation | 1 | done |
| WP2 | Viewport renderer | src/render.ap, tests/unit/render_* | WP0 | lcc-text-graphics | 1 | done |
| WP3 | UI frame: panel, status, messages | src/ui.ap, tests/unit/ui_* | WP0 | lcc-text-graphics | 1 | done |
| WP4 | Economy & calendar | src/economy.ap, tests/unit/eco_* | WP0 | lcc-simulation | 1 | done |
| WP5 | Input & tools | src/input.ap, tests/input.test.json | WP2, WP3 | lcc-game-dev | 2 | done |
| WP6 | Construction rules & costs | src/build.ap, tests/unit/build_*, tests/build.test.json | WP1, WP4 | lcc-simulation | 2 | done |
| WP7 | Ride & stall catalog + operations | src/rides.ap, tests/unit/rides_* | WP1, WP4 | lcc-simulation | 2 | done |
| WP8 | Pathfinding | src/path.ap, tests/unit/path_* | WP1 | lcc-simulation | 2 | done |
| WP9 | Guests | src/guests.ap, tests/unit/guests_*, tests/guests.test.json | WP7, WP8, WP4 | lcc-simulation | 3 | done |
| WP10 | Info & finance windows | src/windows.ap, tests/windows.test.json | WP7, WP9, WP3 | lcc-text-graphics | 3 | done |
| WP11 | Coaster designer (track editing, circuit check) | src/coaster.ap, tests/unit/coaster_* | WP6, WP2 | lcc-text-graphics + lcc-simulation | 4 | done |
| WP12 | Coaster ratings & train animation | src/coaster.ap (after WP11) | WP11, WP7 | lcc-simulation | 5 | done |
| WP13 | Staff (handymen, mechanics), litter, breakdowns | src/staff.ap, tests/unit/staff_* | WP9 | lcc-simulation | 5 | done |
| WP14 | Rating, scenario goal, title screen, win/lose | src/scenario.ap, tests/scenario.test.json | WP9, WP4 | lcc-text-graphics + lcc-simulation | 5 | done |
| WP15 | Sound, polish, balance | (assigned per change) | WP14 | lcc-qa + domain | 6 | done |
| QA-n | Review + playtest after each wave | tests/ only | wave done | lcc-qa | each | QA-1 done |

Interface changes requested by WPs go into small architect WPs (`ARCH-n`, `lcc-architect`)
that run alone between waves.

---

## WP0 — Walking skeleton + data model
**Goal:** game builds, runs and quits; full data model from DESIGN.md in `defs.ap` and
`state.ap`; every module in the Modules table exists as a stub with complete `;;`
contracts (the APIs later WPs implement); main loop calls them in the documented order.
**Acceptance:**
- `node tools/lccgame.js check` passes; `build --map` under budget
- `tests/smoke.test.json`: first frame shows the screen regions (a frame/labels), `q` then confirm halts
- `node tools/lccgame.js api games/park` lists every module's contract
**Log:**
- 2026-11-18 dispatched (validation run of the skill routing). Done: 15 modules stubbed with
  `;;` contracts, 317 defines, 11,681 / 48,000 words, ~129K instr/frame, check 39/39.
  Requests applied to DESIGN.md (staff table, copied message ring, rating → scn_rate,
  path scratch private). Smoke test pins placeholder rows 0, 1, 23, 24, 25, 29 and the
  viewport label: WP2 (viewport), WP3 (panel/status/messages/help) and WP14 (title screen
  shifts the first game frame) may update exactly those expectations.

## WP1 — World & map
**Goal:** `map_init` generates the valley (grass, tree clusters, a lake, fence border, park
gate on the south edge with 3 path tiles); `map_get/map_set/map_in_bounds/map_walkable`
and area checks for footprints (`map_area_free`).
**Acceptance:** unit tests for get/set/bounds/walkable/area; generated map is deterministic
for a given clock and always has a walkable gate path.
**Log:**
- 2026-11-18 dispatched (wave 1, Codex gpt-6.2-sol).
- WP1 hand-back: done, gate (32,47), 7 tree clusters + lake, verified over 1000 seeds. Wave 1 integrated: check 59/59, 14.5K words, ~51K instr/frame.

## WP2 — Viewport renderer
**Goal:** draw the 64x24 viewport from `st_map` with tile palette, ride bodies, guests
overlay, cursor highlight, vertical scrolling that keeps the cursor visible.
**Acceptance:** unit driver renders a hand-made map; tests pin glyph/color of each tile kind,
cursor inversion, scrolling at the bottom edge; ≤ 200K instructions/frame.
**Log:**
- 2026-11-18 dispatched (wave 1, Claude Opus 5.5).
- WP2 hand-back: done, render 7/7 unit tests, 32K instr/frame. Smoke rows 0/1/23 now panel-only regex + cursor bg check. Requests: harness ignores frames[].bg; fence glyph per neighbour (deferred).

## WP3 — UI frame
**Goal:** side panel (current tool/item, cursor tile info), status bar (cash, guests,
rating, date, paused/speed), message log with `ui_msg r0=str`, help line per tool.
**Acceptance:** tests for each region's text; messages scroll; numbers update.
**Log:**
- 2026-11-18 dispatched (wave 1, Claude Opus 5.5).
- WP3 hand-back: done, ui ~11K instr/frame, smoke rows 24/29 updated. Newest message on row 25. Harness far-label id collision fixed by orchestrator (assemble.js iter_line ids). Request: main posts welcome via ui_msg (ARCH).

## WP4 — Economy & calendar
**Goal:** money ops on thousands+units (`eco_can_afford`, `eco_spend`, `eco_earn`,
`eco_cash_text`), calendar advance with new-day/new-month flags, monthly upkeep and
loan interest, entry-fee income hook, monthly income/expense accumulators.
**Acceptance:** unit tests for carry/borrow, refusal when broke, month rollover, upkeep.
**Log:**
- 2026-11-18 dispatched (wave 1, Codex gpt-6.2-sol).
- WP4 hand-back: done, 8 eco scenarios, check 59/59. Monthly bills post to closing month; closed rides still pay upkeep.

## WP5 — Input & tools
**Goal:** every key in DESIGN.md "Controls" works: cursor (wasd, arrows, WASD ×5) clamped to
the map; tool keys 1-6/x; `[ ]` cycle items; space calls `bld_apply`; `i` opens info
(`win_open` contract); `+ -` price of the ride under the cursor or entry fee on the gate;
`o` toggles the ride; `f` finance; `p` pause; `>` speed 1→2→4→1; `q` asks, `y` confirms,
any other key cancels.
**Acceptance:** `tests/input.test.json` scenario: moves, clamps at edges, tool switching,
item cycling, pause/speed, quit cancel + confirm; frames looked at.
**Log:**
- 2026-11-18 Claude Opus 5.5: done. 24 game + 31 unit input scenarios. Found upstream `cmp rX, r4..r7` mis-encoding → orchestrator added a build lint + skill note. Requests: SPEED_MAX 3→4 (ARCH); added tests/unit/input_* (driver it had to extend). Arrows decoded to wasd; ESC w/o window drops tool; space with TOOL_COASTER → cst_begin.

## WP6 — Construction rules & costs
**Goal:** `bld_*` per contract: path/queue/scenery tiles on buildable land (trees cost
extra to clear), rides/stalls via catalog footprint + entrance/exit tiles adjacent to the
footprint (entrance must touch a path or queue when possible), money checked first,
demolish refunds REFUND_PCT %, gate and fence are protected. Messages via `ui_msg`.
**Acceptance:** unit tests for each rule and refusal; `tests/build.test.json` places a path
from the gate, a ride and a stall from the keyboard and shows cash falling.
**Log:**
- 2026-11-18 Codex gpt-6.2-sol: done. Keyboard flow: path+carousel+food stall $10,000→$8,840; demolish refunds $575; gate protected; tree clearing charged per tree, not refunded. Request: note bld_ as writer of R_ENT/R_EXIT (ARCH doc).

## WP7 — Ride & stall catalog + operations
**Goal:** original catalog for RT_CAROUSEL..RT_TOILET (names, footprint, cost, upkeep,
price, capacity, cycle, ratings, cell, goods) and RT_COASTER placeholder; record ops;
`ride_tick` boards guests from the queue, runs the cycle, unloads to the exit, books
income; breakdowns from reliability (RS_BROKEN); stalls sell via `ride_buy`.
**Acceptance:** unit tests for catalog lookups, new/free/at/name, price clamp, toggle,
enqueue refusal when closed, a full board→run→unload cycle with income, stall sale.
**Log:**
- 2026-11-18 Claude Opus 5.5: done. 9 rides_ops scenarios. Catalog: Merry Spinner, Sky Ring, Whirl Swings, Sky Plunge, Bump Arena, Snack Hut, Fizz Kiosk, Restrooms, Track Coaster. Breakdown % = (100-reliab)^2/100 per cycle. Notes for WP9: riders sit on footprint tiles; unload may land on a demolished exit; boarding is lowest-index-first.
- ARCH-1 (orchestrator, between waves 2 and 3): G_SPARE → G_TOILET; SPEED_MAX 3 → 4 (speed tests updated); state.ap notes build as R_ENT/R_EXIT writer. check 125/125.
- QA-1 (Claude Opus 5.5) on WP1-WP7: 2 verified bugs in build.ap (re-apply same tile charges; tree demolish refunds $5×209) + risks (exit ignores paths; demolish drops riders on grass). tests/qa1.test.json 4 pass / 3 BUG. Rest clean: 1-year idle run no drift, ~47K instr/frame. WP6-fix dispatched (Codex).
- WP6-fix (Codex): all 4 QA-1 findings fixed; qa1 BUG scenarios pass and renamed. WP1-WP8 done.

## WP8 — Pathfinding
**Goal:** BFS distance fields over walkable tiles with a small cache keyed by target
(gate + ride entrances), rebuilt only when `st_map_dirty`; `pth_next/dist/to_gate/
random_dir` per contract. Profile: one rebuild ≤ 400K instructions, queries O(1).
**Acceptance:** unit tests on hand-made maps: straight line, detour around water, dead
end/unreachable → DIR_NONE/-1, cache invalidation after map change.
**Log:**
- 2026-11-18 Codex gpt-6.2-sol: done. Cache = gate + 1 most-recent target (6144 words); cold rebuild ~331K instr; ties N,E,S,W. Risk for WP9: several ride targets will thrash the single non-gate field — watch the guest profile; widen cache if needed.

## WP9 — Guests
**Goal:** `gst_*` per contract: arrivals at the gate while the park is open (rate scaled by
rating, entry fee paid via `eco_earn`), needs decay over time, decisions (pick a ride by
excitement/intensity tolerance and price vs cash, food/drink/toilet when a meter is high,
bench when tired, leave when broke/unhappy/late), walking with `pth_next`/`pth_random_dir`,
queue/ride/buy via `ride_enqueue`/`ride_buy`, litter and vomit on the map, thoughts, names.
Time-sliced (1/4 of slots per tick).
**Acceptance:** unit tests for spawn, decay, decision picks, leaving; `tests/guests.test.json`
on a scripted park (path + ride + stall) shows guests arriving, riding and buying, cash
rising; profile ≤ 600K instr/frame with 128 guests at speed 4.
**Log:**
- 2026-11-18 Codex gpt-6.2-sol: done. path.ap cache = gate + 3 attraction fields, one cold build per 9 ticks, new pth_cached. 128 guests/6 targets/speed 4: avg 198K, peak 451K instr/frame. 34.5K/48K words. Orchestrator run: 25 guests by May, cash rising. No gate open/close key (park open by default).

## WP10 — Info & finance windows
**Goal:** `win_*` per contract over the panel: ride window (name, status, price, queue,
riders, ratings, income, total riders; + - o keys), stall window, guest window (name, cash,
meters as bars, thought, rides), tile window, finance window (cash, loan, this/last month
income/expense, park value; b/r borrow/repay).
**Acceptance:** `tests/windows.test.json` opens each window type in a scripted park and pins
its text; keys inside windows work.
**Log:**
- 2026-11-18 Claude Opus 5.5: done. 10 game + 1 unit scenario; ride/stall/guest/tile/finance windows, live refresh, ~25K instr/frame while open; 34.4K/48K words. st_entry_fee writer note updated. Cosmetic request: help row while window open (WP15). Harness: --profile by-routine attribution is off (by-module fine).

## WP11 — Coaster designer
**Goal:** `cst_begin/key/add_piece/undo/closed/finish/cancel/draw`: grid track pieces
(straight, left, right, up, down) from the station, head + ghost preview, costs/refunds,
circuit check back to the station, entrance/exit for the station.
**Acceptance:** unit tests for a closed loop, open track refused, undo refund, cancel,
blocked tile; scenario builds a small loop from the keyboard.
**Log:**
- 2026-11-18 Codex gpt-6.2-sol: done. Station = T_RIDE facing east; track T_TRACK with outgoing dir + height per piece; keyboard loop costs $650 and opens with o; placeholder ratings. check 181/181. Designer writes st_cur_x/y (state note updated).

## WP12 — Coaster ratings & train
**Goal:** `cst_rate` from length, drops (height changes), turns and a speed estimate;
`cst_tick` moves a train along the circuit while open; coaster rides board via rides.ap.
**Acceptance:** unit tests: longer/steeper track rates higher; train position advances
and wraps; scenario shows a train glyph moving.
**Log:**
- 2026-11-18 Codex gpt-6.2-sol: done. Deterministic ratings (small loop: E134 I101 N45), 2-car magenta train, 60-tick laps synced to ride cycle, stops when closed/broken; ≤11K instr/frame with 2 full coasters.

## WP13 — Staff, litter, breakdowns
**Goal:** `stf_*`: handymen sweep litter/vomit near them (wander paths, seek dirty
tiles), mechanics walk to broken rides and repair (RS_BROKEN → RS_OPEN, reliability
restored); hire from the finance window or a key; monthly wages via economy.
**Acceptance:** unit tests for hire/fire/count, sweep, repair; scenario shows a repair.
**Log:**
- 2026-11-18 Codex gpt-6.2-sol: done. Finance window h/m hire, live counts, cap 16. Handymen sweep within 2 path steps; mechanics repair in 12 ticks (+30 reliab). Game run peak 164K instr/frame; dense stress peak 1.44M. Bins don't fill (deferred).

## WP14 — Rating, scenario, title, win/lose
**Goal:** `scn_title` (original title art, 2–3 scenario presets), `scn_start` goals,
`scn_rate` (happiness, ride variety, litter, prices), `scn_check` deadline goals,
`scn_end_screen`.
**Acceptance:** `tests/scenario.test.json`: title → choose → game; rating responds to a
happy vs empty park; forced win and lose screens.
**Log:**
- 2026-11-18 Codex gpt-6.2-sol: done. Original title art; presets Lantern Valley ($10k, 60 guests/600 by Y2), Clover Meadow ($15k, 40/500 by Y3), Switchback Hollow ($6.5k, 70/700 by Y1); Enter = preset 1; all game tests prefixed with one <enter>. Daily goal check; Keep Playing clears goals.

## WP15 — Polish & balance
Assigned per finding from the full-game playtests (sound events, balance numbers, UX).
