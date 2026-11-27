# SCRAPCORE — design

Owner: architect. The orchestrator approves changes; modules follow it. SCRAPCORE is an
**original** turn-based roguelike in the robot-salvage style. Its name, part names, robot
names, layout, art and text are our own. Don't copy names, factions, parts, UI or text
from any existing game.

## Viability (why this scope)

| Constraint (LCC+ on lccjs) | Consequence for the design |
|---|---|
| 16-bit words, 64K-word address space (code + data + stack) | One 64x24 floor in memory at a time, fixed pools (24 enemies, 32 floor items), budget 52K words |
| 8 registers (5 scratch), 16-bit `mul/div` | Power-of-two records, table-driven parts and robots, small integers everywhere (hp ≤ 70, time in TU ≤ 16K, rebased) |
| ~100M instr/s fast player (~5M/s upstream) | Turn-based: idle frames only draw. One BFS (1536 tiles) + one FOV + AI per player action, target ≤ 500K instructions per action frame |
| 100x30 cells, 16 colors, CP437 | Whole floor visible at once (64x24 viewport = map, no scrolling), 36-column side panel, 5-row message log |
| Keyboard only | vi-keys + arrows, single-key commands, number keys for menus |
| No file I/O | No save games (permadeath fits the genre anyway) |
| Single assembly unit | Modules via `.include`, per-module label prefixes, far references handled by the build |

Verdict: viable. Procedural floors, FOV with memory, a time-unit scheduler, 26 parts and
9 robot types fit well inside the budget. Out of reach for v1: heat, hacking, factions,
allies, saving. Estimate 5–8K lines of assembly, 11 work packages + QA, 5 waves.

## Pitch

You are a salvaged robot core waking up at depth 10 of a buried machine complex. Climb
to the surface: take the `<` on depth 1 to win. You **are** your parts. Destroyed
robots drop parts. Attach them to your slots to change how you move, fight and survive.
Incoming hits strike your attached parts first, so they act as your armor and hit points
and get shot off. The core takes the hit only sometimes, more often as you lose parts.
You keep losing and rebuilding your body. The decisions that matter: what to carry, when
to fight and when to sneak past, and which part to swap in.

## Scope

- In: title screen; procedurally generated floors (rooms + corridors, doors, stairs),
  10 depths; FOV radius ~8 with remembered tiles; time-unit scheduler (propulsion sets
  your speed); 8 slots (2 propulsion, 1 power, 3 weapon, 2 utility) + 4 inventory; 26
  parts in 3 tiers; energy (power regen, weapons cost energy); ranged fire mode with
  target cycling, bump melee; damage spread over parts and the core; 9 robot types with
  simple AI (wander, hunt, keep distance, turret, flee, sapper); drops; message log; death and
  win screens with score; help overlay.
- Out (v1): save/load, heat, hacking, factions, allies, part mass/carry limits, item
  stacking, more than one item per tile, sound beyond optional beeps.

## Screen layout (100x30)

```
cols 0-63                                                         cols 64-99
+----------------------------------------------------------------+------------------------------------+
| VIEWPORT rows 0-23 = the whole 64x24 floor (tile x,y = cell y,x)| 0  SCRAPCORE  Depth 10  Turn 123   |
|                                                                | 1  Core   ██████████ 40/40         |
|   #########                                                    | 2  Energy ██████░░░░ 12/20         |
|   #·····@·+········                                            | 3  Move 100  Sight 8  Score Kills 3|
|   #··/····#                         (unknown = blank,          | 4  -- Loadout --  Alarm ░░░░░░░░░░ |
|   #···r···#                          remembered = A_MEMORY,    | 5  P Stub Legs    ████████ 20      |
|   ####+####                          visible = palette)        | 6  P Stub Legs    ████████ 20      |
|                                                                | 7  E Cell Pack    ███████░ 13      |
|                                                                | 8  W Rivet Gun    ████████ 12      |
|                                                                | 9  W Spark Prod   ██████░░ 11      |
|                                                                | 10 W -                             |
|                                                                | 11 U -                             |
|                                                                | 12 U -                             |
|                                                                | 13 -- Carried --                   |
|                                                                | 14 1 W Pulse Rifle  4-7 r8 e4   14/18 |
|                                                                | 15 2 -   (16: 3 -, 17: 4 -)        |
|                                                                | 18 -- Target --                    |
|                                                                | 19 Rifler                          |
|                                                                | 20 ██████░░░░ 9/14                 |
|                                                                | 21 Hit 64%  Dist 5                 |
|                                                                | 22 1 hostile in view               |
|                                                                | 23 Here: Hex Armor [U a2]          |
+----------------------------------------------------------------+------------------------------------+
| rows 24-28 MESSAGES: 5 newest of a 16-slot ring, oldest at top, newest at row 28, colored per msg   |
| row 29 HELP: key help for the current st_mode (A_HELP, black on white)                              |
+-----------------------------------------------------------------------------------------------------+
```

*(The viewport mock shows `#` walls for brevity; actual walls draw as joined CP437 box-drawing glyphs per depth band — see "Depth bands, wall joins and accents" below.)*

Region rectangles are defines: `VIEW_*`, `PANEL_*`, `MSG_ROW/MSG_ROWS`, `HELP_ROW`, and the
panel rows `PR_*`. Row 4 (`PR_LOAD_HDR`) shows a compact 10-cell `Alarm` meter at the right
of `-- Loadout --` (`A_GOOD` up to half `ALARM_MAX`, `A_WARN` past half, `A_BAD` after the
first reinforcement wave). Loadout rows: kind letter at panel col 1 (`P` propulsion, `E`
power, `W` weapon, `U` utility), name at col 3 (≤ 12 chars), integrity bar (width 8) at col 16,
number at col 25. Weapons whose `st_wpn_off` bit is set are dimmed (`A_DIM`) and tagged
`[HOLD]` (`A_WARN`) at col 28 in every mode. Carried rows show digit `1`-`4`, kind letter,
name, compact key stat (weapon damage/range/energy per shot, e.g. `4-7 r8 e4`, `2-5 mel e0`,
or `1-3 r5 e3 S` for stun; propulsion move cost; power regen; utility effect incl. `abs N`
and `drop +N%`), and `hp/max` at panel
col 30; `Here:` shows the floor part name with `[<kind> <stat>]`. In MODE_EQUIP/DROP/RECYCLE the
inventory rows show their digit highlighted `A_SELECT`; in MODE_REMOVE the loadout rows
show digits 1-8; in MODE_TOGGLE the weapon rows (slots 3-5) show digits 1-3 highlighted
`A_SELECT`. Target row 21 shows `Hit NN%  Dist N` for the best active (non-held) in-range
weapon the player can afford; `Low energy  Dist N` (`A_WARN`) when active in-range ranged
weapons exist but none has enough energy; `Out of range  Dist N` when active ranged weapons
are too short; `Weapons held  Dist N` (`A_WARN`) when all ranged weapons are holding fire;
else `No ranged  Dist N`. In MODE_LOOK the viewport highlights `(st_look_x, st_look_y)`
with `A_LOOK_BG` (preserving glyph/fg) and rows 18-21 switch header to `-- Look --` to
inspect what is under the cursor: a visible robot (same name/HP/hit preview as Target),
else a floor item on a known tile (name, `[<kind> <stat>]  hp/max`, tile kind + distance),
else a known tile kind (`Floor`, `Wall`, `Closed door`, `Open door`, `Stairs up`, `Rubble`,
plus `You (core)` on the player or `Remembered` off-LOS), else `Unexplored`. Panel row 22
is a status line showing the active auto-action (`Running...` / `Resting...` /
`Traveling...` / `Exploring... (any key stops)` in `A_LABEL`), or else the count of
visible hostile robots (`N hostile(s) in view` in `A_WARN`), or blank. MODE_HELP draws a
key list box over the viewport; MODE_LOG draws a full 16-message history box over the
viewport oldest→newest in each message's stored `st_msg_attr` color. On reaching the
surface, the panel and win screen display `Surface` instead of `Depth 0`. Death and win
screens include a parts summary line (`Parts: picked up N, lost N, recycled N`) below the
score.

## Controls

Every key can be written in the harness key script (`tools/lib/keys.js`): letters as-is,
`<lt>` for `<`, `<tab>`, `<enter>`, `<esc>`, `<space>`, arrows `<up>` etc.

| Key (script token) | Mode | Action |
|---|---|---|
| `h j k l` | map | move/bump W S N E |
| `y u b n` | map | move/bump NW NE SW SE |
| `<up> <down> <left> <right>` | map | move/bump N S W E (arrives as 27 91 65..68) |
| `H J K L Y U B N` (`Shift+vi-key`) | map | run in direction (`AUTO_RUN`) until blocked, door, junction, item, hostile, message, or key |
| `.` or `<space>` | map | wait (TIME_WAIT) |
| `z` | map | rest (`AUTO_REST`) until energy full and repairs done (stops on hostile, message, or key) |
| `o` | map | auto-explore (`AUTO_EXPLORE`) toward nearest unexplored tile |
| `t` | map | auto-travel (`AUTO_TRAVEL`) toward known `<` stairs |
| `c` then direction | map → close | close an adjacent open door (`TIME_CLOSE`) |
| `g` | map | pick up the part on your tile into the inventory |
| `e` then `1`-`4` | map → equip | attach that inventory part (swaps if its slots are full) |
| `r` then `1`-`8` | map → remove | detach that slot into the inventory |
| `x` then `1`-`4` | map → drop | drop that inventory part on the floor |
| `R` then `1`-`4` | map → recycle | scrap that carried part to restore core integrity (`TIME_RECYCLE`) |
| `a` then `1`-`8`, `1`-`4` | map → bay slot → bay part | at a service bay, sacrifice a carried part to repair a damaged attached part (`TIME_BAY`) |
| `w` then `1`-`3` | map → toggle | toggle hold-fire (`st_wpn_off`) on weapon slot 3-5 (held weapons do not fire or swing) |
| `f` | map → target | targeting: reuses current target if still visible, else nearest visible hostile (Tinkers only if no hostiles visible) |
| `F` | map | quick-fire at once at the last / nearest visible target |
| `<tab>` or `]` / `[` | target | next / previous visible robot |
| `f` or `<enter>` | target | fire every active (non-held) ranged weapon that reaches and has energy |
| `<esc>` | target | cancel targeting back to map mode and restore previous target (`st_target`) |
| `;` | map → look | enter look mode (`st_look_x/y`): starts on current target if still visible, else nearest visible robot, else player |
| `hjkl/yubn/arrows` (`Shift+vi-key` ×8) | look | move look cursor (Shift jumps 8 tiles) |
| `<tab>` or `]` / `[` | look | jump look cursor between visible robots |
| `f` or `<enter>` | look | target the visible robot under the cursor (enters target mode) |
| `<esc>` or `;` | look | exit look mode back to map mode |
| `m` | map → log | message history overlay (all 16 ring messages); any key closes |
| `<esc>` | any menu | cancel back to map mode |
| `<lt>` | map | take the stairs up (on a `<` tile) |
| `?` | map → help | help overlay; any key closes |
| `Q` then `y`/`Y` | map → quit | quit; any other key cancels |
| any key / `Q` | title | start / quit |
| any key / `Q` | end screen | play again / quit |

Esc vs arrows: on 27 the player module reads the next byte with `nbain`. 0 means Esc,
91 means an arrow (one more byte). Any other byte means Esc followed by that key: it is
kept in a one-word pushback cell (`ply_pushback`) that `ply_handle` consumes before the
next `nbain`, so Esc + a key in the same frame loses nothing. Lowercase `q` does nothing, so you can't quit by
accident.

## Data model

All shared constants are in `src/defs.ap` and all shared state is in `src/state.ap`.
Static tables belong to their module: the part catalog is `prt_catalog` in parts.ap and
the robot types are `act_types` in actors.ap.

- **Map** `st_map: .zero MAP_SIZE` (64x24 = 1536 words), index `(y<<6)|x`, one T_* kind
  per word (bits 0-3, rest 0). Kinds: 0 T_ROCK (undug, blocks), 1 T_FLOOR, 2 T_WALL,
  3 T_DOOR (closed: walkable, opaque; opens when entered), 4 T_DOOR_OPEN, 5 T_STAIRS `<`,
  6 T_RUBBLE (floor variant), 7 T_FIXTURE (`st_fixtures`). Written only by dungeon (`dun_set`, also for door opening).
- **FOV** `st_fov: .zero MAP_SIZE`, bits FOV_VISIBLE 1, FOV_KNOWN 2. Written only by fov.
- **Render map** `st_rmap: .zero MAP_SIZE`, placed immediately after `st_fov` (`st_rmap == st_fov + MAP_SIZE`; `render.ap` reads it at that fixed offset and `tests/unit/tile_kinds` asserts the layout). One `RK_*` render kind per tile: `0..7` = `T_*` kind, `RK_WALL0` (8) + 4-bit join mask for `T_WALL`, `RK_ACCENT_A` (24) / `RK_ACCENT_B` (25) for floor accents, `RK_FIX_SPENT` (26) for a `T_FIXTURE` with 0 `F_CHARGES`, `RK_COUNT` = 32. Written only by dungeon: `dun_rk_all` at the end of `dun_generate`, and refreshed by `dun_set` (only the changed tile when wall-joinability did not change, e.g. door open/close; otherwise the tile plus every wall in the surrounding 3×3).
- **Rooms** `st_rooms` MAX_ROOMS 12 × ROOM_SIZE 4: RM_X, RM_Y (interior top-left), RM_W,
  RM_H; `st_room_count`, `st_start_room`; `st_stairs_x/y`.
- **Loadout** `st_slots` NUM_SLOTS 8 × SLOT_SIZE 2: S_PART (id, 0 = empty), S_HP
  (integrity). Slots 0-1 propulsion, 2 power, 3-5 weapon, 6-7 utility. **Inventory**
  `st_inv` NUM_INV 4 × 2, same layout. Written only by parts.
- **Part catalog** (static, parts.ap) PART_COUNT 26 × PART_SIZE 16: P_KIND, P_NAME
  (string address), P_CELL (glyph|fg), P_MAXHP, P_TIER, P_COVER, then kind stats in
  P_S0..P_S5 plus P_W_FX. Weapon: P_W_DMIN, P_W_DMAX, P_W_RANGE, P_W_ENERGY, P_W_ACC,
  P_W_MELEE, P_W_FX (`WFX_*`). Propulsion: P_M_COST, P_M_EVADE, P_M_TYPE. Power:
  P_E_REGEN, P_E_CAP. Utility: P_U_TYPE, P_U_VALUE.
- **Robot types** (static, actors.ap) ETYPE_COUNT 9 × ETYPE_SIZE 16: ET_NAME, ET_CELL,
  ET_HP, ET_SPEED, ET_ATK_TIME, ET_DMIN, ET_DMAX, ET_RANGE, ET_ACC, ET_AI, ET_DLO,
  ET_DHI, ET_DROP (address of `count, id, id, ...`), ET_DROP_PCT, ET_SIGHT, ET_WEIGHT.
- **Enemies** `st_enemies` MAX_ENEMIES 24 × ENEMY_SIZE 16: E_TYPE (0 = free), E_X,
  E_Y, E_HP, E_NEXT (next-act time), E_STATE (ES_IDLE/HUNT/FLEE), E_TX, E_TY,
  E_ALERT, E_FLAGS (EF_SEEN/EF_ARMED/EF_BLOWN/EF_STUNNED/EF_REINF/EF_ALARMED), 10-15 spare for actors. Written by actors. Combat writes
  E_HP and frees records through `act_kill`.
- **Floor items** `st_items` MAX_ITEMS 32 × ITEM_SIZE 4: I_PART (0 = free), I_X, I_Y,
  I_HP. One item per tile. Written by items.
- **Player** `st_px/st_py`, `st_ply_next` (TU), `st_core_hp` (0..CORE_MAX 40),
  `st_energy` (0..st_energy_max), regen/repair accumulators.
- **Derived stats** (written only by `prt_recalc`): `st_move_cost`, `st_regen`,
  `st_energy_max`, `st_sight`, `st_acc_bonus`, `st_evade`, `st_repair_turns`, plus
  v2 `st_shield` and `st_salvage`.
- **Game** `st_game_state` (GAME_TITLE/PLAY/DEAD/WON), `st_mode` (MODE_MAP..MODE_BAY_PART,
  incl. MODE_LOOK/LOG/TOGGLE/CLOSE/RECYCLE/BAY_SLOT/BAY_PART), `st_depth` (10..1), `st_depth_best`, `st_turn`
  (player actions), `st_time` (scheduler clock, TU), `st_kills`, `st_target` (enemy index
  or -1), `st_climb`, `st_death_cause` (EN_*), `st_seed`, `st_frame`.
- **QoL controls** `st_auto` (AUTO_NONE/RUN/REST/TRAVEL/EXPLORE), `st_auto_dx/dy`,
  `st_auto_steps`, `st_look_x/y` (MODE_LOOK cursor), `st_wpn_off` (bit i set = loadout
  slot i holds fire, weapon slots 3-5). Written by player (`st_wpn_off` bit cleared when
  a slot gets a new part or is emptied by remove) and, for `st_wpn_off`, by parts
  (clears the bit when that part is destroyed). Read by combat, ui, render.
- **v2 state** (appended to `src/state.ap`): floor alarm `st_alarm` (written by actors and
  combat — `cbt_blast` adds `ALARM_BLAST`), `st_alarm_acc`, `st_alarm_waves` (written by
  actors; all three reset per floor in `act_spawn_floor`); barrier
  & salvage `st_shield`, `st_salvage` (written by `prt_recalc`) and `st_absorbed`
  (last barrier absorption in `prt_damage`, written by parts); run summary counters
  `st_stat_salvaged` (pickup actions, written by player), `st_stat_lost` and `st_stat_recycled`
  (written by parts), all three zeroed in `main_new_game`.
- **Fixtures** (appended) `st_fixtures` MAX_FIXTURES 4 × FIX_SIZE 4: F_X, F_Y, F_TYPE
  (`FX_NONE`/`FX_BAY`), F_CHARGES. Written by dungeon (`dun_generate`) and player
  (F_CHARGES); `st_bay_slot` written by player.
- **Messages** `st_msg_text` MSG_COUNT 16 × MSG_LEN 64 (copied, NUL-terminated, so a
  message can contain names and numbers), `st_msg_attr[16]`, `st_msg_head`. Written only
  by `ui_msg*`.
- **Display** `st_screen`: header (100, 30, 0, 0) plus `st_cells` (3000).

### Depth bands, wall joins and accents

- **Why a shadow map (`st_rmap`):** packing a wall join mask into `st_map` bits 4–7 would have required auditing ~10 `st_map` readers across `actors`, `fov`, `items` and `ui` that compare unmasked tile kinds. Keeping `st_rmap` separate preserves every `st_map` invariant and keeps `ren_slow4` branchless at the same per-tile cost.
- **Wall joining:** each `T_WALL` gets `RK_WALL0` (8) + 4-bit join mask (N=1, E=2, S=4, W=8). A neighbor joins if it is `T_WALL`, `T_DOOR` or `T_DOOR_OPEN`; off-map neighbors never join. Unjoined walls (mask 0, or `ren_tile_cell(T_WALL)`) draw `#`.
- **Parallel-run rule:** two side-by-side wall runs do not join each other — a horizontal run (E+W joined) drops its N or S join when that neighbor also has joinable tiles on both sides, and a vertical run (N+S joined) does the same for E or W — so double walls draw as two clean lines instead of rows of tees.
- **Floor accents:** `T_FLOOR` tiles get `RK_ACCENT_A` on hash value 0 and `RK_ACCENT_B` on value 1 of 32 from a pure squared hash of `(x, y, dun_depth)` — using the depth of the last `dun_generate` (`dun_depth`), not `st_depth`, and never the RNG — so shared-seed versus races see identical floors and RNG streams (unit-tested: `dun_rk_all` leaves `rand` output unchanged). Because the squared hash is non-uniform, accents appear on about 1 in 12 floors with A roughly twice as common as B (measured over the full 64×24 map: 76 A + 52 B = 128/1536 at depth 10, 82 A + 40 B = 122/1536 at depth 3).
- **Depth bands:** `render.ap` selects one of three 128-word tables from `st_depth` each frame (`BAND_SLAG_MIN` 8, `BAND_CONDUIT_MIN` 4), indexed by `(fov << 5) + render kind` (4 blocks of 32: unknown blank, visible, remembered in `A_MEMORY` blue, visible). Visible colors per band below; remembered tiles stay `A_MEMORY` blue, stairs (`<` bright yellow) are shared across all bands, and unjoined walls draw `#`:

| Band | Depths | Walls | Floor | Doors | Rubble | Floor accents (A / B) |
|---|---|---|---|---|---|---|
| Slag Vaults | 10–8 | double-line yellow (`═║`) | `·` yellow | bright yellow | gray | red `∙` slag beads / gray `°` cinders |
| Conduit Works | 7–4 | single-line cyan (`─│`) | `·` gray | yellow | gray | white `:` grating / cyan `∙` cable studs |
| Intake Shafts | 3–1 | bright-white double-H / single-V (`═│`) | `·` white | bright cyan | green | gray `∙` grit / green `"` moss tufts |

- **Cost & scope:** per-frame render cost is unchanged; the new-floor frame rises from ~82K to ~154K instructions (`dun_rk_all`), well inside the 500K per-frame target. `dun_set` refreshes only the changed tile (~100 instructions) unless the tile enters or leaves the joinable set {`T_WALL`, `T_DOOR`, `T_DOOR_OPEN`}, in which case it also refreshes every wall in its 3×3 (~1K instructions); gameplay only calls `dun_set` for door open/close, which never changes joinability, and any future bulk wall-destruction feature should rebuild with `dun_rk_all` instead of per-tile `dun_set`. A plain-ASCII fallback tile set is deliberately deferred to issue #13 (host-side glyph packs).

## Part catalog

Tier 1 appears from depth 10, tier 2 from depth 7 (TIER2_DEPTH), tier 3 from depth 3
(TIER3_DEPTH). Floor glyph by kind: propulsion `=`, power `*`, weapon `/`, utility `&`.
Color by tier: white, bright cyan, bright magenta. Names are ≤ 12 chars.

| id | Name | Kind | Tier | HP | Cover | Stats |
|---|---|---|---|---|---|---|
| 1 | Stub Legs | prop (legs) | 1 | 20 | 3 | cost 100, evade 5 |
| 2 | Strut Legs | prop (legs) | 2 | 32 | 3 | cost 90, evade 8 |
| 3 | Caster Wheel | prop (wheels) | 1 | 12 | 2 | cost 70, evade 10 |
| 4 | Rim Wheels | prop (wheels) | 2 | 18 | 2 | cost 60, evade 12 |
| 5 | Grip Treads | prop (treads) | 1 | 45 | 5 | cost 140, evade 0 |
| 6 | Siege Treads | prop (treads) | 3 | 70 | 6 | cost 130, evade 0 |
| 7 | Lift Fan | prop (hover) | 2 | 10 | 1 | cost 50, evade 15 |
| 8 | Grav Skimmer | prop (hover) | 3 | 16 | 1 | cost 40, evade 20 |
| 9 | Cell Pack | power | 1 | 15 | 2 | regen 2, cap +20 |
| 10 | Arc Battery | power | 2 | 22 | 2 | regen 3, cap +35 |
| 11 | Fusion Knot | power | 3 | 30 | 3 | regen 5, cap +50 |
| 12 | Spark Prod | weapon melee | 1 | 15 | 3 | 2-5, range 1, energy 0, acc 80 |
| 13 | Rivet Gun | weapon | 1 | 12 | 3 | 2-4, range 7, energy 2, acc 70 |
| 14 | Scatter Tube | weapon | 1 | 14 | 3 | 1-6, range 4, energy 3, acc 75 |
| 15 | Pulse Rifle | weapon | 2 | 18 | 3 | 4-7, range 8, energy 4, acc 70 |
| 16 | Cutter Arm | weapon melee | 2 | 25 | 4 | 5-9, range 1, energy 1, acc 80 |
| 17 | Coil Lance | weapon | 3 | 22 | 3 | 7-12, range 9, energy 7, acc 65 |
| 18 | Ram Hammer | weapon melee | 3 | 35 | 4 | 8-14, range 1, energy 2, acc 75 |
| 19 | Scrap Plate | utility armor | 1 | 30 | 6 | -1 damage to itself |
| 20 | Hex Armor | utility armor | 2 | 50 | 8 | -2 damage to itself |
| 21 | Optic Mast | utility sensor | 1 | 8 | 1 | +3 sight |
| 22 | Patch Drone | utility repair | 2 | 10 | 1 | 1 integrity every 3 turns |
| 23 | Aim Gyro | utility target | 2 | 10 | 1 | +15% accuracy |
| 24 | Jolt Caster | weapon | 2 | 14 | 3 | 1-3, range 5, energy 3, acc 75, stun (`WFX_STUN`, once per action) |
| 25 | Barrier Grid | utility shield | 2 | 12 | 1 | absorbs up to 3/hit (`SHIELD_COST` 2 energy/pt) |
| 26 | Salvage Rig | utility salvage | 1 | 10 | 1 | +25% drop chance; drops at 75-100% integrity |

See "v2 features" below for stun, barrier absorption, and salvage drop rules. Starting
loadout: 2× Stub Legs, Cell Pack, Rivet Gun, Spark Prod. That gives move 100,
energy 40, regen 3. Five slots filled, so the core-hit chance is 6 + 3×6 = 24%.

## Enemy table

Depth range: a type spawns on depths ET_DHI down to ET_DLO (10 = deepest, start).

| id | Name | Glyph | HP | Step TU | Atk TU | Damage | Range | Acc | AI | Depths | Sight | Drop % | Drops (part ids) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Flit | `f` bright cyan | 6 | 50 | 60 | 1-3 | 1 | 60 | melee | 10-5 | 7 | 40 | 7, 3, 13, 21 |
| 2 | Scuttler | `s` yellow | 12 | 100 | 100 | 2-5 | 1 | 70 | melee | 10-4 | 6 | 50 | 1, 12, 19, 9 |
| 3 | Rifler | `r` bright red | 14 | 100 | 100 | 2-5 | 6 | 60 | ranged | 9-1 | 8 | 50 | 13, 14, 15, 9, 2 |
| 4 | Watcher | `W` magenta | 20 | — | 100 | 2-5 | 8 | 55 | turret | 8-1 | 8 | 60 | 15, 23, 10, 21 |
| 5 | Bulwark | `B` bright white | 40 | 150 | 120 | 4-8 | 1 | 70 | melee | 6-1 | 6 | 70 | 5, 6, 20, 18, 16 |
| 6 | Stalker | `k` bright magenta | 22 | 60 | 80 | 4-8 | 7 | 70 | ranged | 4-1 | 10 | 60 | 8, 17, 11, 4, 22 |
| 7 | Tinker | `t` green | 8 | 80 | — | — | 0 | — | worker | 10-1 | 6 | 80 | 19, 21, 22, 23, 9 |
| 8 | Leech | `l` bright green | 10 | 70 | 100 | 1-3 | 1 | 70 | melee | 9-3 | 7 | 60 | 9, 10, 25 |
| 9 | Sapper | `x` bright yellow | 8 | 60 | 100 | 4-8 (blast) | 1 | — | sapper | 8-1 | 8 | 0 | (none) |

See "v2 features" below for Leech energy drain, Sapper arm/blast behavior, and floor alarm
reinforcements. Per floor: SPAWN_BASE 4 + (11 − depth)/2 hostile robots (types eligible for the depth,
weighted by ET_WEIGHT), plus one Tinker. None spawn in the start room or within
SPAWN_SAFE 6 tiles of the player.

## Turn system

- One clock `st_time` in TU, where TIME_TURN = 100 TU is one normal action. The
  player acts when `st_ply_next ≤ E_NEXT` of every enemy (ties go to the player).
- A player action adds its cost to `st_ply_next` (`ply_spend`). Costs:
  - move = `st_move_cost`
  - melee TIME_MELEE 100, fire TIME_FIRE 100, wait 100, pick up 100, stairs 100 (climbing a floor reinforces the core by +10 HP, capped at CORE_MAX)
  - attach/detach TIME_SWAP 150, recycle TIME_RECYCLE 150, drop 50
  - menus, targeting, help and blocked moves cost nothing
- Move cost is the average P_M_COST of the attached propulsion parts, +LIMP_EXTRA 30
  with only one, and CRAWL_COST 250 with none.
- `act_run` then lets enemies act in E_NEXT order while `E_NEXT < st_ply_next`. Each
  enemy action adds ET_SPEED for a step, ET_ATK_TIME for an attack, or TIME_WAIT. Then
  `st_time = st_ply_next`. When the clock reaches TIME_REBASE (16384), act_run
  subtracts it from every time cell, so 16-bit math never overflows.
- `prt_tick(elapsed)`: each full TIME_TURN elapsed gives `st_energy += st_regen`
  (capped). With a repair part, every `st_repair_turns` turns it repairs 1 integrity on
  whichever of the core or attached parts is missing the largest fraction of its max
  integrity (ties prefer the core, then the earlier slot).
- The player does at most one action per frame. Remaining keys wait for the next frame.
  Idle frames only redraw.

## AI

Distance field: `act_run` runs a BFS from the player over `dun_walkable` tiles once per
player action (1536 words, private to actors; one MAP_SIZE 1536-word BFS queue is shared
with player pathing `act_player_path` for travel/explore via `act_bfs_release`, keeping
the field valid so the next rebuild clears it in full instead of using the visit list).

- **Sighting:** an enemy sees the player when the distance is ≤ ET_SIGHT and `fov_los`
  is clear. It enters ES_HUNT, sets E_TX/E_TY to the player, and sets E_ALERT to
  ALERT_TURNS. The first sighting while the enemy is on a visible tile posts
  "<Name> spotted.".
- **Losing the player:** a hunting enemy that can't see the player walks greedily toward
  E_TX/E_TY; if that step is blocked it waits. It uses the player-seeded distance field
  (BFS) only while it sees the player or when E_TX/E_TY equals the player's position,
  so normal robots never track the player through walls. Reinforcement-wave robots
  (`EF_REINF`) are the exception: while hunting (`E_ALERT > 0`), the floor alarm refreshes
  their `E_TX/E_TY` to the player's position each action so they keep pathing via BFS
  until their alert expires. E_ALERT counts down, and at 0 it goes back to ES_IDLE.
- **Hit by the player:** a robot that survives player damage is alerted (`act_alert`):
  E_TX/E_TY = player, E_ALERT = ALERT_TURNS, ES_IDLE → ES_HUNT (AI_WORKER → ES_FLEE),
  so sniping from beyond ET_SIGHT wakes it.
- **Idle:** random step (50%) or wait.
- **AI_MELEE:** attacks when adjacent; otherwise steps to the neighbor with the lowest
  distance value.
- **AI_RANGED:** at distance ≤ 2 it steps away (higher distance value). Otherwise it
  attacks if in range with LOS, else approaches.
- **AI_TURRET:** never moves; attacks when in range with LOS, else waits.
- **AI_WORKER:** never attacks. When it sees the player it flees (highest distance
  value), otherwise wanders.
- **Fleeing:** hp below FLEE_PCT 25% of max puts any non-turret into ES_FLEE (steps
  away).
- **Movement rules:** no step onto the player, another enemy, or a non-walkable tile.
  Entering T_DOOR opens it.

## Combat

- **Distance:** Chebyshev (`dun_dist`).
- **Hit chance:** `cbt_hit_chance(acc, dist)` = acc − 3×(dist−1), clamped 10..95.
  - Player weapons: acc = P_W_ACC + st_acc_bonus.
  - Enemies: ET_ACC, then − st_evade, floored at HIT_MIN.
- **Fire** (`f` … `f`): every weapon slot with P_W_MELEE 0, P_W_RANGE ≥ distance, target
  visible (`fov_visible`), and P_W_ENERGY available fires in slot order. Each shot spends
  energy, rolls to hit and does rng_range(DMIN..DMAX). If nothing fires, no time passes:
  "Not enough energy." when an in-range ranged weapon lacked only energy, else
  "Nothing can fire.".
- **Melee** (bump into a robot): every melee weapon slot swings (each spends its energy
  if available, else is skipped). With none, the core rams for 1-3 at 70%.
- **Damage to the player** (`prt_damage`): the core is hit with chance CORE_HIT_PCT 6
  + CORE_HIT_EMPTY 6 × empty slots. Otherwise one attached part is picked, weighted by
  P_COVER. Armor parts reduce damage to themselves by P_U_VALUE (min 1). A part at 0
  integrity is destroyed: slot emptied, derived stats recomputed, and the destroyed part
  id is reported to the caller (`cbt_enemy_attack` posts "<Part> destroyed!" in A_BAD
  after the hit message). Core at 0 means GAME_DEAD, with st_death_cause = attacker type.
- **Robots:** have plain hp. At 0: "<Name> destroyed.", st_kills++, ET_DROP_PCT chance
  to drop one random part from ET_DROP at 50–100% integrity on its tile (or nearby),
  record freed.
- **Score** = (10 − shallowest depth reached) × 100 + kills × 10, + 1000 for reaching
  the surface (winning sets st_depth_best = 0, so all 10 depths count).

## Memory budget (words)

| Item | Words |
|---|---|
| display block 100x30 | 3004 |
| map + fov + rmap 3 × 1536 | 4608 |
| actors distance field, player-path first steps, shared BFS queue (3 × 1536, private) | 4608 |
| enemies 24×16, items 32×4, slots/inv 24, rooms 48 | ~590 |
| messages 16×64 + 17 | ~1041 |
| other state | ~60 |
| part catalog 26×16 + names, robot types 9×16 + names + drop lists | ~920 |
| render depth-band tables 3 × 128 | 384 |
| **measured total / budget.words** | **30,846 / 52000** |

WP0 skeleton: 8,510 words (7,211 of them state + display). Measured program size is
30,846 words (28,690 on `main` before depth-band tile sets), including 785
far-reference rewrites (+1,634 words; was 772 / +1,609, and 2,318 / +5,550 before fixing
`tools/lib/assemble.js`, where the upstream assembler emitted no word for an out-of-range
instruction in pass 2, shifting later addresses and forcing needless far rewrites). In
`actors`, `act_player_path` calls `act_bfs_release` before reusing the shared queue; the
AI distance field stays valid and its next rebuild clears the whole field.

Budget policy: `games/scrap/game.json` sets `budget.words` to 52000 (was 40000; harness
warns at 56,000), deliberately above the `lcc-architect` skill's general ~48K guidance.
The program grows up from `0x0000` and the stack down from `0xFFFF` with no heap, leaving
13,536 words of stack at 52,000 words. Measured stack peaks are 153 words across all game
scenario tests and fuzzed play, and ~845–887 words with a scratch 24-Sapper chain-reaction
driver (not committed; `cbt_blast` → `cbt_damage_enemy`, ~35 words/level, capped at
`MAX_ENEMIES` = 24 because each Sapper is freed before the next blast). The only other
recursion is the FOV scan, bounded by `SIGHT_MAX` = 14 (~210 words). Worst-case stack
stays under 1K words (>10× margin).

## Modules

Contracts are authoritative in each file's `;;` lines (`node tools/lccgame.js api
games/scrap`). Calling convention everywhere: args r0..r4, result r0, everything else
preserved.

| File | Prefix | Owner | Responsibility | Public API | Domain skill |
|---|---|---|---|---|---|
| main.ap | main_ | architect | flow, frame loop, new game/floor, climbing, turn sequencing | main_start main_new_game main_new_floor main_turn | lcc-architect |
| src/defs.ap | — | architect | constants, record layouts, regions, palette, keys, tuning | — | lcc-architect |
| src/state.ap | st_ | architect | all shared state | data | lcc-architect |
| src/rng.ap | rng_ | architect | uniform random ranges from the RNG's high bits | rng_range | lcc-simulation |
| src/dungeon.ap | dun_ | WP1 | generator, tiles, walkable/opaque, random floor, distance | dun_generate dun_get dun_set dun_rk_all dun_walkable dun_opaque dun_random_floor dun_room_of dun_dist dun_fix_at | lcc-simulation |
| src/fov.ap | fov_ | WP2 | visibility + memory, line of sight | fov_reset fov_update fov_visible fov_known fov_los | lcc-simulation |
| src/parts.ap | prt_ | WP3 | catalog, slots, inventory, derived stats, energy, repair, damage spread | prt_init prt_recalc prt_info prt_name prt_kind prt_slot_kind prt_attach prt_detach prt_inv_add prt_inv_clear prt_recycle prt_bay_repair prt_damage prt_tick prt_spend_energy prt_random_part prt_free_slots | lcc-simulation |
| src/ui.ap | ui_ | WP4 | panel, bars, messages, help row, menus, help overlay, title/end screens | ui_init ui_title ui_draw ui_end_screen ui_msg ui_msg_add ui_msg_addn ui_msg_attr ui_bar ui_score | lcc-text-graphics |
| src/render.ap | ren_ | WP5 | map viewport layers | ren_draw ren_tile_cell | lcc-text-graphics |
| src/items.ap | itm_ | WP6 | floor item pool, per-floor loot | itm_clear itm_place itm_at itm_remove itm_spawn_floor | lcc-simulation |
| src/actors.ap | act_ | WP7 | robot types, pool, spawning, scheduler, AI, target cycling | act_init act_clear act_spawn_floor act_spawn act_at act_run act_think act_type_info act_name act_kill act_alert act_next_visible | lcc-simulation |
| src/combat.ap | cbt_ | WP8 | hit chance, fire, melee, enemy attacks, destruction, drops | cbt_hit_chance cbt_player_fire cbt_player_melee cbt_enemy_attack cbt_damage_enemy cbt_blast | lcc-simulation |
| src/player.ap | ply_ | WP9 | input modes, player actions | ply_init ply_handle ply_key ply_move ply_spend ply_pickup ply_equip ply_remove ply_drop ply_recycle ply_target ply_fire ply_stairs ply_bay_start ply_bay_slot ply_bay_part | lcc-game-dev |

Dependency direction (who calls whom): main → everything. player → dungeon, items,
parts, actors, combat, ui. actors → dungeon, fov, combat, ui. combat → parts, items,
actors, dungeon, fov, ui. parts calls nothing outside itself. items → dungeon, parts.
render → dungeon, fov, items, actors, parts. ui → parts, actors (names), combat (hit
chance for the target panel). dungeon and fov call nothing but each other (fov →
dun_opaque).

## Frame loop & timing

FRAME_MS 50. Every frame: `ply_handle` drains keys until one action. On PR_ACTED,
`main_turn` runs: climb (new floor or win) or `act_run` → `prt_tick` → `st_turn++` →
`fov_update`. Then `ren_draw`, `ui_draw`, `video_present`, `sleep`. When the game state
leaves PLAY, the end screen runs, then the title again.

Instruction budget: an idle frame is ~105K (skeleton, mostly fills). Target ≤ 300K idle
and ≤ 500K on an action frame. Smoke test caps every frame at 1M.

## Randomness

`millis` → `st_seed` → `srand` once at start. Every random roll goes through
`rng_range lo hi` (src/rng.ap), never `rand` directly: the LCC+ `rand` returns
`state % range` from a 16-bit LCG whose low bits have period 2, so small power-of-two
ranges gave only two values per game. `rng_range` takes the full 16-bit state
(`rand` with min 0, max 0xFFFF) and scales its high byte: lo + (state>>8)×range>>8
(ranges up to 256). A run is reproducible in the headless harness for a given `--clock`.

## Open questions

- Whether the core alone (no weapons) should get a free weak ranged zap. For now the
  answer is no: a weaponless core can only ram.
- Balance (spawn counts, drop rates, energy costs) is WP10's job once the game is
  playable.

## v2 features (WP11–WP13)

Constants live in `src/defs.ap` (`ALARM_*`, `BLAST_*`, `UT_SHIELD`, `UT_SALVAGE`,
`WFX_*`, `RECYCLE_*`, `MODE_RECYCLE`); state cells are appended at the end of
`src/state.ap`.

### New parts (catalog ids 24–26, `prt_catalog`)

| id | Name | Kind | Tier | HP | Cover | Stats |
|---|---|---|---|---|---|---|
| 24 | Jolt Caster | weapon | 2 | 14 | 3 | 1-3, range 5, energy 3, acc 75, P_W_FX = WFX_STUN (once per action) |
| 25 | Barrier Grid | utility shield | 2 | 12 | 1 | absorbs up to 3 damage per hit, SHIELD_COST 2 energy per point |
| 26 | Salvage Rig | utility salvage | 1 | 10 | 1 | +25% robot drop chance; drops at 75–100% integrity |

All three names fit `PART_NAME_MAX` (12 chars).

- **Stun (`WFX_STUN`):** a player weapon hit that leaves the robot alive stuns it
  (`E_NEXT += STUN_TU`) only if it is not already stunned; it is then flagged
  `EF_STUNNED` until its next action (`act_think` clears the flag), so a robot acts at
  least once between stuns (no stun-lock). When stunned, the hit message appends
  `Stunned!`.
- **Barrier (`UT_SHIELD`):** `prt_recalc` sets `st_shield` to the best attached
  `P_U_VALUE` (0 if none). `prt_damage` first absorbs
  `a = min(damage, st_shield, st_energy / SHIELD_COST)` points, spends
  `a × SHIELD_COST` energy, and stores `a` in `st_absorbed` (0 when nothing was
  absorbed). Any remaining damage applies as usual. If the hit is fully absorbed,
  `prt_damage` returns **-2** (no part or core hit). Combat reports the damage dealt
  (`rolled − st_absorbed`) plus the absorbed amount (`(N absorbed)`), or
  `<Robot> hits. Barrier absorbs N.` / `Barrier absorbs blast (N).` on full absorption.
- **Salvage (`UT_SALVAGE`):** `prt_recalc` sets `st_salvage` to the best attached
  `P_U_VALUE`. When a robot with a non-empty drop list is destroyed, its drop chance
  becomes `ET_DROP_PCT + st_salvage` (capped at 100) and, when `st_salvage > 0`, the
  dropped part rolls `rng_range(SALVAGE_HP_MIN..100)%` integrity instead of
  `DROP_HP_MIN..100`.
- **Panel / Here / Look stat text:** Jolt Caster appends `S` to its weapon stats
  (`1-3 r5 e3 S`), Barrier Grid shows `abs 3`, and Salvage Rig shows `drop +25%`.

### Recycling (`R`, `MODE_RECYCLE`)

Pressing `R` then `1`-`4` breaks down a carried inventory part to restore core integrity:
`heal = 1 + (RECYCLE_BASE + RECYCLE_TIER × tier) × hp / maxhp`, capped at `CORE_MAX`.
Costs `TIME_RECYCLE`, increments `st_stat_recycled`, and logs
`Recycled <Part>. Core +<N>.`. An empty slot (`No carried part there.`) or a full core
(`Core integrity is full.`) spends no time and keeps the part. `Esc` cancels. Inventory
digits highlight in `A_SELECT` like `MODE_EQUIP`/`MODE_DROP`; the help bar
(`RECYCLE: 1-4 scrap carried part for core HP   Esc cancel`) and `?` overlay both list
it. Spare parts now double as emergency repair material: carry, attach, or scrap.

### Service bays (`a`, `MODE_BAY_SLOT` / `MODE_BAY_PART`)

Each floor places one single-use service bay (`FX_BAY`, bright-green `Ω` ready, gray `Ω` spent)
at the center of a room that is neither the start room nor the stairs room. Stepping onto a ready
bay posts `Service bay here (1 use). Press a to repair a part.` (stopping auto-explore/run);
`Here:` and `-- Look --` show `Service bay (1 use)` or `Service bay (spent)`.

Pressing `a` checks in order at no time cost: bay underfoot (`No service bay here.`), charge left
(`This service bay is spent.`), a damaged attached part (`No attached part needs repair.`), and a
carried spare (`No carried part to sacrifice.`). Then a two-step picker opens (`Esc` cancels at
either step): `1`-`8` picks a damaged loadout slot (`Slot is empty.` / `That part is undamaged.`),
and `1`-`4` sacrifices a carried part (`No carried part there.`). The spare is destroyed and the
chosen part regains `BAY_MULT × (1 + (RECYCLE_BASE + RECYCLE_TIER × tier) × hp / maxhp)` integrity
(`BAY_MULT` = 2, capped at missing integrity). Costs `TIME_BAY` (150 TU), spends the bay, and logs
`Bay repaired <Part> +<N>.` (bay messages live in `src/player.ap`).

### Equip preview

In `MODE_EQUIP`, panel rows 18–22 replace `-- Target --` and hide the row 22 status line, showing `-- Equip preview --` and one row per carried entry (`1`–`4`).
Each occupied row shows `<inv>→<slot>` (1–8), the replaced part's name or `empty`, and non-zero stat deltas (or `same stats` when a replacement changes no stat), colored green when better and red when worse.
Target slot prediction uses the same rule as attaching: the first free slot of the part's kind, else the attached part of that kind with the lowest integrity ratio (ties go to the last slot).
Non-weapon deltas (`mv` move cost, `ev` evade, `rg` regen, `en` energy capacity, `si` sight, `ai` aim, `sh` shield, `sv` salvage) come from a side-effect-free trial recompute of derived stats; armor (`ar`) is taken directly from the part, and repair (`rp`) is shown as a `+` or `-` sign only.
Weapon deltas (`d` average damage in `.5` steps, `r` range, `e` energy, `a` accuracy) appear only when replacing a weapon; an empty weapon slot shows no deltas because the carried row already lists the weapon's stats.

### New robots (`act_types` ids 8–9)

| id | Name | Glyph | HP | Step TU | Atk TU | Damage | Range | Acc | AI | Depths | Sight | Drop % | Drops | Weight |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 8 | Leech | `l` bright green | 10 | 70 | 100 | 1-3 | 1 | 70 | melee | 9-3 | 7 | 60 | 9, 10, 25 | like Scuttler |
| 9 | Sapper | `x` bright yellow | 8 | 60 | 100 | BLAST | 1 | — | sapper | 8-1 | 8 | 0 | (none) | a bit below Rifler |

- **Leech:** each damaging hit also drains `min(LEECH_DRAIN, st_energy)` energy and
  reports `(-N energy)` in the hit message. Full Barrier absorption blocks the drain.
- **Sapper (`AI_SAPPER`):** hunts like `AI_MELEE` and never flees. When its turn comes
  up adjacent to the player without `EF_ARMED`, it sets `EF_ARMED`, posts
  `Sapper arms its charge!` (`A_WARN`), and spends `ET_ATK_TIME`. If already armed and
  adjacent, it detonates. An armed Sapper that loses adjacency keeps chasing and
  detonates on its next turn adjacent to the player; while `EF_ARMED` is set, each step
  costs `ET_ATK_TIME` (100 TU) instead of `ET_SPEED` (60 TU), so a player on 100-TU legs
  who steps away gets a turn before it can close and detonate. The renderer highlights a
  visible armed Sapper with `A_ARMED_BG` (`BG_MAGENTA`, preserving glyph and fg; target
  highlight wins in `MODE_TARGET`).
- **Blast (`cbt_blast r0=x r1=y r2=cause`):** posts `Sapper explodes!` (or `Explosion!`)
  in `A_BAD`, adds `ALARM_BLAST` to `st_alarm`, hits the player if within `BLAST_RADIUS`
  (Chebyshev) for `rng_range(BLAST_DMIN..BLAST_DMAX)` through `prt_damage` (always hits,
  ignores evade, Barrier applies, core death sets `st_death_cause = cause`), and deals
  `BLAST_ROBOT` damage via `cbt_damage_enemy` to every other living robot within
  `BLAST_RADIUS`. Robots surviving a blast are **not** alerted to the player's position
  (only direct player hits call `act_alert`). Every non-`EF_REINF` robot destroyed by any
  blast counts as a kill and drops normally (per its drop table; Sappers have no drops) —
  including a second Sapper caught in the blast of an enemy Sapper that blew itself up
  next to the player. A Sapper destroyed by player fire/melee or by another blast counts
  as a kill (unless `EF_REINF`) and then detonates on its tile; the only exception is the
  Sapper that detonates itself next to the player, which is removed with no kill and no
  drop. `EF_BLOWN` ensures each Sapper blasts at most once so chain reactions always
  terminate.

### Floor alarm and reinforcements

- `act_spawn_floor` resets `st_alarm`, `st_alarm_acc`, and `st_alarm_waves` to 0.
- `act_run` adds `ALARM_PER_TURN` per `TIME_TURN` of world time elapsed (accumulated in
  `st_alarm_acc`). The first time a Watcher sees the player (in sight + LOS) without
  `EF_ALARMED`, it sets `EF_ALARMED` and adds `ALARM_WATCHER` to `st_alarm` (even if
  `act_alert` already put it in `ES_HUNT`); re-sightings never add again. Every blast adds
  `ALARM_BLAST` to `st_alarm` (from `combat.ap`).
- When `st_alarm ≥ ALARM_MAX`: `act_alarm_wave` refreshes FOV (`fov_update`, so tiles
  exposed by enemy-opened doors during the enemy phase are excluded) and the actors BFS
  distance field, increments `st_alarm_waves`, resets `st_alarm = ALARM_MAX − REINF_AFTER`,
  and spawns up to `REINF_COUNT` depth-eligible hostile robots (by `ET_WEIGHT`, excluding
  `AI_TURRET` and `AI_WORKER`) on reachable floor tiles (finite BFS distance from the
  player) ≥ `REINF_MIN_DIST` from the player and outside FOV — already in `ES_HUNT`
  targeting the player with `E_ALERT = REINF_ALERT` and flagged `EF_REINF`. While an
  `EF_REINF` robot stays in `ES_HUNT` (`E_ALERT > 0`), the floor alarm keeps its
  `E_TX/E_TY` updated to the player's position each action so it continues pathing via BFS
  even if the player moves out of sight (normal robots keep the no-omniscience rule).
  Destroying an `EF_REINF` robot still posts `<Name> destroyed.` (and an `EF_REINF` Sapper still
  detonates), but grants no `st_kills` credit and no part drop. `Floor alarm!
  Reinforcements incoming!` (`A_BAD`) is posted only if at least one robot spawned (if the
  pool is full or no qualifying tile exists, no message is posted, while `st_alarm_waves`
  still increments and `st_alarm` still resets).
- The panel shows a compact `Alarm` meter on the Loadout header row that shifts from
  `A_GOOD` to `A_WARN` past half and `A_BAD` after the first wave. Lingering, resting,
  and letting Watchers spot you now carry real risk.

### Run summary

Death and win screens add a parts breakdown line below the score
(`Parts: picked up N, lost N, recycled N`), tracking pickup actions (`st_stat_salvaged`),
destroyed attached parts (`st_stat_lost`), and recycled parts (`st_stat_recycled`).
`main_new_game` zeroes all three counters.
