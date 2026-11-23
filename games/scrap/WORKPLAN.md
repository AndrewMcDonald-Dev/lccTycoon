# SCRAPCORE — work plan

Owner: orchestrator. Update after every dispatch and hand-back.
Status: `todo | active | review | done | blocked`. A WP may start when its dependencies are
`done`, its files don't overlap an `active` WP, and every routine it calls exists (stub ok).
Every WP's skills list adds `lcc-game-dev`, `lccplus-assembly` and `lccjs-assembly` to the
domain skill shown. Contracts: `node tools/lccgame.js api games/scrap`. Formulas and tables:
DESIGN.md.

| WP | Title | Owns (files) | Depends | Domain skill | Wave | Status |
|----|-------|--------------|---------|--------------|------|--------|
| WP0 | Walking skeleton + data model | game.json, main.ap, src/defs.ap, src/state.ap, stubs of all modules, tests/smoke.test.json, tests/unit/dungeon_* | — | lcc-architect | 0 | done |
| WP1 | Dungeon generator | src/dungeon.ap, tests/unit/dungeon_* | WP0 | lcc-simulation | 1 | done |
| WP2 | FOV + line of sight | src/fov.ap, tests/unit/fov_* | WP0 | lcc-simulation | 1 | done |
| WP3 | Parts, loadout, energy, damage spread | src/parts.ap, tests/unit/parts_* | WP0 | lcc-simulation | 1 | done |
| WP4 | UI: panel, messages, help, menus, title/end screens | src/ui.ap, tests/unit/ui_* | WP0 | lcc-text-graphics | 1 | done |
| WP5 | Map viewport renderer | src/render.ap, tests/unit/render_* | WP1, WP2 | lcc-text-graphics | 2 | done |
| WP6 | Floor items | src/items.ap, tests/unit/items_* | WP1, WP3 | lcc-simulation | 2 | done |
| WP7 | Robots: types, spawning, scheduler, AI | src/actors.ap, tests/unit/actors_* | WP1, WP2 | lcc-simulation | 2 | done |
| WP8 | Combat | src/combat.ap, tests/unit/combat_* | WP3, WP6, WP7 | lcc-simulation | 3 | done |
| WP9 | Player input + actions + integration | src/player.ap, main.ap (integration fixes only), tests/play.test.json | WP3, WP4, WP6, WP7 | lcc-game-dev | 3 | done |
| QA-1 | Review + scripted playthroughs | tests/qa1.test.json (+ findings report) | wave 3 | lcc-qa | 4 | done |
| WP10 | Balance + polish (QA-1 fixes, tuning) | per finding: defs tuning (ARCH), catalog in parts.ap, act_types in actors.ap, ui text | QA-1 | lcc-qa + domain | 5 | done |
| QA-2 | Final playtest: win path, death path, perf | tests/qa2.test.json | WP10 | lcc-qa | 5 | done |

Waves (files are disjoint within a wave):
- **Wave 1:** WP1, WP2, WP3, WP4. WP2's drivers write st_map directly. WP4 uses fake
  st_slots/st_inv contents in its unit driver.
- **Wave 2:** WP5, WP6, WP7.
- **Wave 3:** WP8, WP9. They call each other only through the existing stub contracts.
  WP9 owns the whole-game scenarios.
- **Wave 4:** QA-1. **Wave 5:** WP10, then QA-2.

Interface changes requested by WPs (new defines/state cells/routines) go into small
architect WPs (`ARCH-n`, `lcc-architect`) that run alone between waves.

Smoke test placeholders (tests/smoke.test.json): it pins only state (`st_game_state`,
`st_depth`, `st_mode`, `st_core_hp`, `st_turn`, `st_time`, `st_ply_next`, `st_frame`), `.` waiting one
action per frame (TIME_WAIT each), the text "SCRAPCORE" on the
title and on the game frame, an `@` on the game frame, the help row background being
white (A_HELP), and the quit prompt text `Quit? y = yes, any other key = no`. WP4 may
update the title/panel/help expectations; WP9 must keep the quit and wait behavior. No WP should
need to touch the other assertions.

---

## WP0 — Walking skeleton + data model
**Goal:** game builds, runs and quits; full data model in `defs.ap`/`state.ap`; every
module stubbed with complete `;;` contracts; main loop calls them in the documented order.
**Acceptance:**
- `node tools/lccgame.js check` passes; `build --map` under budget
- `tests/smoke.test.json`: title, game frame regions, `Q` + `y` quits, cancel works
- `node tools/lccgame.js api games/scrap` lists every module's contract
**Log:**
- 2026-11-21 done. 12 modules (9 stubs), 8,510 / 40,000 words, ~105K instr/idle frame,
  smoke 12/12 + dungeon unit 1/1, repo check 222/222. Stub `.` wait exercises main_turn.

## WP1 — Dungeon generator
**Log:** 2026-11-21 wave 1 (WP1-4, Gemini 4 Neon) integrated: check 244/244, 18.3K/40K words; FOV 34K instr worst case. Wave 2 (WP5-7, Neon) integrated: check 259/259; render ~35K instr worst case. Wave 3 (WP8-9, Neon) integrated: check 279/279. QA-1 dispatched (Opus).
**Goal:** `dun_generate` builds a floor as specified in its contract and DESIGN.md: rooms
(ROOMS_MIN..MAX_ROOMS, sizes ROOM_MIN/MAX_*) with walls, L-shaped corridors connecting
all rooms, doors (DOOR_PCT), rubble, one `<` far from the start room, and the player
placed in `st_start_room`. Also tile access, walkable/opaque, `dun_random_floor`,
`dun_room_of`, `dun_dist`.
**Acceptance:** extend tests/unit/dungeon_*. Cover: outside-map cases still hold;
get/set round trip; walkable/opaque per kind; the player tile is T_FLOOR; the stairs tile
is T_STAIRS and reachable from the player (BFS in the driver, or a flood count compared
with the floor-tile count) over 50+ seeds (`clock`); `dun_random_floor` always returns a
room floor tile; `dun_dist` cases. Map generation ≤ 400K instructions. Look at a few
generated floors (driver that draws st_map to the screen, or after WP5 the game).

## WP2 — FOV + line of sight
**Goal:** `fov_update` (radius `st_sight`, FOV_VISIBLE|FOV_KNOWN), `fov_reset`,
`fov_visible`, `fov_known`, `fov_los`.
**Acceptance:** unit drivers on hand-made maps (write st_map directly; link the real
dungeon.ap or a stub with `dun_opaque`). Cover: open room fully visible within radius,
nothing beyond it; a wall hides what is behind it but is visible itself; a closed door
blocks and an open door doesn't; known persists after moving away while visible clears;
los symmetric on test pairs; outside-map queries return 0. `fov_update` ≤ 60K
instructions at radius 8.

## WP3 — Parts, loadout, energy, damage spread
**Goal:** catalog table exactly as in DESIGN.md "Part catalog". Implement every `prt_`
contract: starting loadout, recalc of derived stats, attach/detach/swap, inventory,
damage spread with armor, destruction messages via `ui_msg` (stub it in the driver),
tick (regen/repair), energy spend, random part by depth tier.
**Acceptance:** unit tests: starting loadout → st_move_cost 100, st_energy_max 40,
st_regen 3, st_sight 8; attach to a free slot, swap when full, wrong-kind handling,
detach into a full inventory (-2); recalc with one leg (+LIMP_EXTRA), with none
(CRAWL_COST), hover evade; damage with a fixed seed hits parts and the core; armor
reduction; part destroyed empties the slot and posts the message; core 0 → GAME_DEAD;
tick regen caps at max; repair over N turns; prt_random_part never returns a tier above
the depth's allowance (sample 200 calls).

## WP4 — UI
**Goal:** panel exactly as in DESIGN.md "Screen layout", `ui_bar`, the message ring
(`ui_msg`, `ui_msg_add`, `ui_msg_addn`, `ui_msg_attr`), message rows (newest at the
bottom, older in A_MSG_OLD), the help row per mode, menu highlights, help overlay, title
and end screens (death cause name via `act_type_info`/ET_NAME, score via `ui_score`).
**Acceptance:** unit driver with fake st_slots/st_inv/st_enemies/state. Tests pin panel
rows, bar fills at 100%/50%/10% with their colors, empty-slot rows, message truncation
at 63 chars, ring wrap after 8+ messages, help row text for every MODE_*, the end screen
for dead and won, and that `ui_title`/`ui_end_screen` return the right value for `Q` vs
another key. Update tests/smoke.test.json expectations if the title/panel text moves.
`ui_draw` ≤ 120K instructions.

## WP5 — Map viewport renderer
**Goal:** `ren_draw` and `ren_tile_cell` per contract: tiles by FOV state with the
palette, items/enemies only on visible tiles, the player, target highlight in MODE_TARGET.
Write cells directly (no per-cell video_put).
**Acceptance:** unit driver with a hand-made st_map/st_fov/items/enemies. Tests pin glyph
and color (`colors`) for every tile kind visible vs remembered vs unknown, an item and an
enemy hidden when not visible, the target bg (`bg`). Run the game and look at a real
floor (`run --show changed --colors`). ≤ 150K instructions/frame.

## WP6 — Floor items
**Goal:** item pool per contract, including nearest free tile placement and
`itm_spawn_floor`.
**Acceptance:** unit tests: place/at/remove, a second place on the same tile goes next
door, pool full → -1, spawn count within LOOT_MIN..LOOT_MAX on generated floors, never
on the stairs/player, all on walkable tiles.

## WP7 — Robots: types, spawning, scheduler, AI
**Goal:** `act_types` exactly as in DESIGN.md "Enemy table" (drop lists included); every
`act_` contract: pool, spawn per depth, BFS distance field, `act_run` scheduler with
rebasing, `act_think` AI (sighting, hunt, ranged spacing, turret, worker flee, low-hp
flee, idle wander, door opening), `act_next_visible`. Attacks call `cbt_enemy_attack`
(stub until WP8).
**Acceptance:** unit tests on hand-made maps: a fast enemy (Flit, 50 TU) acts twice per
100 TU player action, a Bulwark twice every three; ties go to the player; rebasing keeps
order; melee robot closes distance along a corridor and calls attack when adjacent (count
calls in a stub combat); ranged robot holds distance ≥ 3; turret never moves; worker moves
away; no two robots on one tile; spawn counts per depth and depth ranges respected over
many seeds. `act_run` ≤ 250K instructions with 12 enemies.

## WP8 — Combat
**Goal:** every `cbt_` contract with the DESIGN.md formulas; messages; drops via
`itm_place`; kills; death cause.
**Acceptance:** unit tests with fixed seeds: hit chance clamps and distance penalty;
fire uses only ranged weapons in range with energy, spends energy, returns 0 when nothing
can fire; melee with and without melee weapons (ram); enemy attack damages parts through
prt_damage and sets st_death_cause on a kill; destroyed robot → kills+1, record freed,
drop placed with ET_DROP_PCT 100 (test hook: a test-only type or patched pct in the
driver), st_target cleared.

## WP9 — Player input, actions and integration
**Goal:** every `ply_` contract and mode in DESIGN.md "Controls" (vi-keys, arrows,
wait, pickup, equip/remove/drop menus, targeting + fire, stairs, help, quit). Keep the
WP0 quit behavior. Owns integration fixes in main.ap (report any change).
**Acceptance:** tests/play.test.json whole-game scenarios with a fixed `clock`: moving
changes st_px/st_py and st_turn; walls block without time passing; bump attack on an
adjacent robot; `g` picks up, `e1` attaches (slot changes, derived stats update), `r4`
detaches, `x1` drops; `f` with no target posts the message and stays in map mode; `f`
`<tab>` `f` fires and costs time; `<lt>` on the stairs climbs to depth 9 (find the stairs
by reading st_stairs_x/y and scripting a path, or a debug-free scenario seed); Esc
cancels every menu; arrows move. Look at the frames for every behavior.

## QA-1 — Review + scripted playthroughs
**Log:** 2026-11-21 QA-1 (Opus): ~60 bot playthroughs, no crash/hang; 3 bugs (fire vs FOV mismatch, death screen skipped by typed-ahead key, message order), UX gaps, core attrition balance. Fixed in WP10a/WP10b (Neon); qa1 replays re-recorded; check 291/291.
**Goal:** code review of every module against its contract (lcc-qa checklist), plus
scripted playthroughs over several seeds: survive/die, climb at least two floors, part
loss and re-equip. Findings as replayable BUG scenarios in tests/qa1.test.json.

## WP10 — Balance + polish
**Log:** 2026-11-22 council R1 fixes (Gemini partial, finished by Opus): rng_range high-bit RNG helper (src/rng.ap) replaces every `rand`; hunting robots no longer BFS-track an unseen player; player damage alerts robots (act_alert); target panel "Low energy" + "Not enough energy." + weapon energy in part stats; Esc+key pushback. play.test.json replays re-derived; qa1 replays need re-recording.
**Goal:** fix QA-1 findings and tune the game so a careful player can usually reach depth
5–7 and sometimes win. Tunables: spawn counts, drop rates, energy costs, core-hit chance,
part stats. Changes to defs.ap values go through the orchestrator (ARCH).

## QA-2 — Final playtest
**Goal:** a scripted win (patched depth 1 start in a driver or a long scenario), a
death screen with the right cause and score, performance under the frame budget with 24
enemies, `check` green.

- 2026-11-22 QA-2: qa1 replays re-recorded after the RNG fix; tests/qa2.test.json = recorded autoplayer win on clock 32 (989 turns, score 2430, no memory pokes) + play-again after win. 60-seed bot sweep after the fixes: deaths spread over depths 8..1, 1 win. check 295/295.

## WP11a — Arch: v2 interface
**Status:** done (Opus). defs/state/catalog rows 24-26/main counter reset; DESIGN.md "v2
features". RNG-dependent replays (play/qa1/qa2/qol) and the actors/parts catalog unit
tests go red by design (PART_COUNT 26 changes loot rolls); fixed in WP12/WP13.

## WP11 — v2 simulation (Neon): Leech, Sapper + blasts, stun, salvage drops, alarm + reinforcements
**Files:** src/actors.ap, src/combat.ap, tests/unit/actors*, tests/unit/combat*, tests/unit/v2_sim_*, tests/v2_sim.test.json
**Status:** done (Neon).
**Log:** 2026-11-22 done (Neon): Leech drain, Sapper arm/detonate + chain blasts, weapon stun, salvage drops, floor alarm + reinforcements in actors/combat; actors/combat + v2_sim_* tests passing.

## WP12 — v2 parts/player/UI (Sol): barrier, salvage/shield recalc, recycling, render armed Sapper, alarm meter, part stats, run summary
**Files:** src/parts.ap, src/player.ap, src/ui.ap, src/render.ap, tests/unit/parts*, player*, render*, ui*, tests/unit/v2_ui_*, tests/v2_ui.test.json
**Status:** done (Sol).
**Log:** 2026-11-22 done (Sol): Barrier Grid absorption, shield/salvage recalc, `R` recycling, armed Sapper highlight, alarm meter, v2 part stats, run summary in parts/player/ui/render; 33.6K/40K words, v2_ui_* tests passing.

## WP13 — Wording pass (Neon) + replay re-record + QA (Sol)
**Status:** active (WP13a/WP13c done; WP13b in progress).
**Log:**
- 2026-11-22 WP13a done (Neon): wording pass (`Barrier Field` → `Barrier Grid`).
- 2026-11-22 WP13b active (Sol): re-recording replays (`play`/`qa1`/`qa2`/`qol_*`) and v2 balance pass.
- 2026-11-22 WP13c done (Neon): title screen updated for Leech `l`, Sapper `x`, and `R` recycle; DESIGN.md and WORKPLAN.md synced with v2.
- 2026-11-22 QA (Sol) found the stun cap did not stop stun-lock → EF_STUNNED once-per-action rule (Opus); blast kill credit clarified.

## WP14 — Council R1 simulation fixes (Neon)
**Files:** src/actors.ap, src/combat.ap, src/ui.ap (`ui_se_salvaged` only), tests/unit/v2_sim_*, tests/v2_sim.test.json, tests/v2_ui.test.json, tests/unit/v2_ui_controls.test.json, DESIGN.md, WORKPLAN.md
**Status:** done (Neon).
**Log:**
- 2026-11-22 done (Neon): `act_alarm_wave` refreshes FOV (`fov_update`) and BFS before spawn, spawns only reachable tiles with `E_ALERT = REINF_ALERT` and `EF_REINF` (no `st_kills`/drop; Sapper still detonates), and posts the alarm message only if ≥1 spawned; `cbt_blast` suppresses `act_alert` on surviving collateral via `cbt_blast_depth`; armed Sapper steps pay `ET_ATK_TIME`; Watcher alarm uses once-per-Watcher `EF_ALARMED`; `ui_se_salvaged` renamed to `"Parts: picked up "`; DESIGN.md/WORKPLAN.md synced.
- 2026-11-22 WP16 (Neon, finished by Opus): council R2 — EF_REINF wave robots track the player while alerted (BFS), early exit when the pool is full, help overlay spacing, "Score Kills" labels, stun-across-rebase / 24-Sapper chain / prt_damage(0) / recycle over-max / barrier+armor tests; DESIGN scope and module table synced.
