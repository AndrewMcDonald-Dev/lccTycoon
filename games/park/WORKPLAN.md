# Park Builder — work plan

Owner: orchestrator. Update after every dispatch and hand-back.
Status: `todo | active | review | done | blocked`. A WP may start when its dependencies are
`done`, its files don't overlap an `active` WP, and every routine it calls exists (stub ok).
Every WP's skills list adds `lcc-game-dev`, `lccplus-assembly` and `lccjs-assembly` to the
domain skill shown.

| WP | Title | Owns (files) | Depends | Domain skill | Wave | Status |
|----|-------|--------------|---------|--------------|------|--------|
| WP0 | Walking skeleton + data model | game.json, main.ap, src/defs.ap, src/state.ap, stubs of all modules, tests/smoke.test.json | — | lcc-architect | 0 | done |
| WP1 | World & map | src/map.ap, tests/unit/map_* | WP0 | lcc-simulation | 1 | todo |
| WP2 | Viewport renderer | src/render.ap, tests/unit/render_* | WP0 | lcc-text-graphics | 1 | todo |
| WP3 | UI frame: panel, status, messages | src/ui.ap, tests/unit/ui_* | WP0 | lcc-text-graphics | 1 | todo |
| WP4 | Economy & calendar | src/economy.ap, tests/unit/eco_* | WP0 | lcc-simulation | 1 | todo |
| WP5 | Input & tools | src/input.ap, tests/input.test.json | WP2, WP3 | lcc-game-dev | 2 | todo |
| WP6 | Construction rules & costs | src/build.ap, tests/unit/build_*, tests/build.test.json | WP1, WP4 | lcc-simulation | 2 | todo |
| WP7 | Ride & stall catalog + operations | src/rides.ap, tests/unit/rides_* | WP1, WP4 | lcc-simulation | 2 | todo |
| WP8 | Pathfinding | src/path.ap, tests/unit/path_* | WP1 | lcc-simulation | 2 | todo |
| WP9 | Guests | src/guests.ap, tests/unit/guests_*, tests/guests.test.json | WP7, WP8, WP4 | lcc-simulation | 3 | todo |
| WP10 | Info & finance windows | src/windows.ap, tests/windows.test.json | WP7, WP9, WP3 | lcc-text-graphics | 3 | todo |
| WP11 | Coaster designer (track editing, circuit check) | src/coaster.ap, tests/unit/coaster_* | WP6, WP2 | lcc-text-graphics + lcc-simulation | 4 | todo |
| WP12 | Coaster ratings & train animation | src/coaster.ap (after WP11) | WP11, WP7 | lcc-simulation | 5 | todo |
| WP13 | Staff (handymen, mechanics), litter, breakdowns | src/staff.ap, tests/unit/staff_* | WP9 | lcc-simulation | 5 | todo |
| WP14 | Rating, scenario goal, title screen, win/lose | src/scenario.ap, tests/scenario.test.json | WP9, WP4 | lcc-text-graphics + lcc-simulation | 5 | todo |
| WP15 | Sound, polish, balance | (assigned per change) | WP14 | lcc-qa + domain | 6 | todo |
| QA-n | Review + playtest after each wave | tests/ only | wave done | lcc-qa | each | todo |

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

## WP2 — Viewport renderer
**Goal:** draw the 64x24 viewport from `st_map` with tile palette, ride bodies, guests
overlay, cursor highlight, vertical scrolling that keeps the cursor visible.
**Acceptance:** unit driver renders a hand-made map; tests pin glyph/color of each tile kind,
cursor inversion, scrolling at the bottom edge; ≤ 200K instructions/frame.
**Log:**

## WP3 — UI frame
**Goal:** side panel (current tool/item, cursor tile info), status bar (cash, guests,
rating, date, paused/speed), message log with `ui_msg r0=str`, help line per tool.
**Acceptance:** tests for each region's text; messages scroll; numbers update.
**Log:**

## WP4 — Economy & calendar
**Goal:** money ops on thousands+units (`eco_can_afford`, `eco_spend`, `eco_earn`,
`eco_cash_text`), calendar advance with new-day/new-month flags, monthly upkeep and
loan interest, entry-fee income hook, monthly income/expense accumulators.
**Acceptance:** unit tests for carry/borrow, refusal when broke, month rollover, upkeep.
**Log:**

## WP5 – WP15
Expand each section (goal + acceptance) when its wave is planned, from DESIGN.md.
