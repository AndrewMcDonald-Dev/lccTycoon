# SCRAPCORE — design

Owner: architect. The orchestrator approves changes; modules follow it. SCRAPCORE is an
**original** turn-based roguelike in the robot-salvage style. Its name, part names, robot
names, layout, art and text are our own. Don't copy names, factions, parts, UI or text
from any existing game.

## Viability (why this scope)

| Constraint (LCC+ on lccjs) | Consequence for the design |
|---|---|
| 16-bit words, 64K-word address space (code + data + stack) | One 64x24 floor in memory at a time, fixed pools (24 enemies, 32 floor items), budget 40K words |
| 8 registers (5 scratch), 16-bit `mul/div` | Power-of-two records, table-driven parts and robots, small integers everywhere (hp ≤ 70, time in TU ≤ 16K, rebased) |
| ~100M instr/s fast player (~5M/s upstream) | Turn-based: idle frames only draw. One BFS (1536 tiles) + one FOV + AI per player action, target ≤ 500K instructions per action frame |
| 100x30 cells, 16 colors, CP437 | Whole floor visible at once (64x24 viewport = map, no scrolling), 36-column side panel, 5-row message log |
| Keyboard only | vi-keys + arrows, single-key commands, number keys for menus |
| No file I/O | No save games (permadeath fits the genre anyway) |
| Single assembly unit | Modules via `.include`, per-module label prefixes, far references handled by the build |

Verdict: viable. Procedural floors, FOV with memory, a time-unit scheduler, ~23 parts and
7 robot types fit well inside the budget. Out of reach for v1: heat, hacking, factions,
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
  your speed); 8 slots (2 propulsion, 1 power, 3 weapon, 2 utility) + 4 inventory; 23
  parts in 3 tiers; energy (power regen, weapons cost energy); ranged fire mode with
  target cycling, bump melee; damage spread over parts and the core; 7 robot types with
  simple AI (wander, hunt, keep distance, turret, flee); drops; message log; death and
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
|   #·····@·+········                                            | 3  Move 100  Sight 8  Kills 3      |
|   #··/····#                         (unknown = blank,          | 4  -- Loadout --                   |
|   #···r···#                          remembered = A_MEMORY,    | 5  P Stub Legs    ████████ 20      |
|   ####+####                          visible = palette)        | 6  P Stub Legs    ████████ 20      |
|                                                                | 7  E Cell Pack    ███████░ 13      |
|                                                                | 8  W Rivet Gun    ████████ 12      |
|                                                                | 9  W Spark Prod   ██████░░ 11      |
|                                                                | 10 W -                             |
|                                                                | 11 U -                             |
|                                                                | 12 U -                             |
|                                                                | 13 -- Carried --                   |
|                                                                | 14 1 Pulse Rifle  ██████░░ 14      |
|                                                                | 15 2 -   (16: 3 -, 17: 4 -)        |
|                                                                | 18 -- Target --                    |
|                                                                | 19 Rifler                          |
|                                                                | 20 ██████░░░░ 9/14                 |
|                                                                | 21 Hit 64%  Dist 5                 |
|                                                                | 23 Here: Hex Armor                 |
+----------------------------------------------------------------+------------------------------------+
| rows 24-28 MESSAGES: 5 newest of an 8-slot ring, oldest at top, newest at row 28, colored per msg   |
| row 29 HELP: key help for the current st_mode (A_HELP, black on white)                              |
+-----------------------------------------------------------------------------------------------------+
```

Region rectangles are defines: `VIEW_*`, `PANEL_*`, `MSG_ROW/MSG_ROWS`, `HELP_ROW`, and the
panel rows `PR_*`. Slot rows: kind letter at panel col 1 (`P` propulsion, `E` power, `W`
weapon, `U` utility), name at col 3 (≤ 12 chars), integrity bar (width 8) at col 16,
number at col 25. In MODE_EQUIP/DROP the inventory rows show their digit highlighted
`A_SELECT`; in MODE_REMOVE the loadout rows show digits 1-8. MODE_HELP draws a key list
box over the viewport.

## Controls

Every key can be written in the harness key script (`tools/lib/keys.js`): letters as-is,
`<lt>` for `<`, `<tab>`, `<enter>`, `<esc>`, `<space>`, arrows `<up>` etc.

| Key (script token) | Mode | Action |
|---|---|---|
| `h j k l` | map | move/bump W S N E |
| `y u b n` | map | move/bump NW NE SW SE |
| `<up> <down> <left> <right>` | map | move/bump N S W E (arrives as 27 91 65..68) |
| `.` or `<space>` | map | wait (TIME_WAIT) |
| `g` | map | pick up the part on your tile into the inventory |
| `e` then `1`-`4` | map → equip | attach that inventory part (swaps if its slots are full) |
| `r` then `1`-`8` | map → remove | detach that slot into the inventory |
| `x` then `1`-`4` | map → drop | drop that inventory part on the floor |
| `f` | map → target | targeting: nearest visible robot selected |
| `<tab>` or `]` / `[` | target | next / previous visible robot |
| `f` or `<enter>` | target | fire every ranged weapon that reaches and has energy |
| `<esc>` | any menu | cancel back to map mode |
| `<lt>` | map | take the stairs up (on a `<` tile) |
| `?` | map → help | help overlay; any key closes |
| `Q` then `y`/`Y` | map → quit | quit; any other key cancels |
| any key / `Q` | title | start / quit |
| any key / `Q` | end screen | play again / quit |

Esc vs arrows: on 27 the player module reads the next byte with `nbain`. 0 means Esc,
91 means an arrow (one more byte). Lowercase `q` does nothing, so you can't quit by
accident.

## Data model

All shared constants are in `src/defs.ap` and all shared state is in `src/state.ap`.
Static tables belong to their module: the part catalog is `prt_catalog` in parts.ap and
the robot types are `act_types` in actors.ap.

- **Map** `st_map: .zero MAP_SIZE` (64x24 = 1536 words), index `(y<<6)|x`, one T_* kind
  per word (bits 0-3, rest 0). Kinds: 0 T_ROCK (undug, blocks), 1 T_FLOOR, 2 T_WALL,
  3 T_DOOR (closed: walkable, opaque; opens when entered), 4 T_DOOR_OPEN, 5 T_STAIRS `<`,
  6 T_RUBBLE (floor variant). Written only by dungeon (`dun_set`, also for door opening).
- **FOV** `st_fov: .zero MAP_SIZE`, bits FOV_VISIBLE 1, FOV_KNOWN 2. Written only by fov.
- **Rooms** `st_rooms` MAX_ROOMS 12 × ROOM_SIZE 4: RM_X, RM_Y (interior top-left), RM_W,
  RM_H; `st_room_count`, `st_start_room`; `st_stairs_x/y`.
- **Loadout** `st_slots` NUM_SLOTS 8 × SLOT_SIZE 2: S_PART (id, 0 = empty), S_HP
  (integrity). Slots 0-1 propulsion, 2 power, 3-5 weapon, 6-7 utility. **Inventory**
  `st_inv` NUM_INV 4 × 2, same layout. Written only by parts.
- **Part catalog** (static, parts.ap) PART_COUNT 23 × PART_SIZE 16: P_KIND, P_NAME
  (string address), P_CELL (glyph|fg), P_MAXHP, P_TIER, P_COVER, then kind stats in
  P_S0..P_S5. Weapon: P_W_DMIN, P_W_DMAX, P_W_RANGE, P_W_ENERGY, P_W_ACC, P_W_MELEE.
  Propulsion: P_M_COST, P_M_EVADE, P_M_TYPE. Power: P_E_REGEN, P_E_CAP. Utility:
  P_U_TYPE, P_U_VALUE.
- **Robot types** (static, actors.ap) ETYPE_COUNT 7 × ETYPE_SIZE 16: ET_NAME, ET_CELL,
  ET_HP, ET_SPEED, ET_ATK_TIME, ET_DMIN, ET_DMAX, ET_RANGE, ET_ACC, ET_AI, ET_DLO,
  ET_DHI, ET_DROP (address of `count, id, id, ...`), ET_DROP_PCT, ET_SIGHT, ET_WEIGHT.
- **Enemies** `st_enemies` MAX_ENEMIES 24 × ENEMY_SIZE 16: E_TYPE (0 = free), E_X,
  E_Y, E_HP, E_NEXT (next-act time), E_STATE (ES_IDLE/HUNT/FLEE), E_TX, E_TY,
  E_ALERT, E_FLAGS (EF_SEEN), 10-15 spare for actors. Written by actors. Combat writes
  E_HP and frees records through `act_kill`.
- **Floor items** `st_items` MAX_ITEMS 32 × ITEM_SIZE 4: I_PART (0 = free), I_X, I_Y,
  I_HP. One item per tile. Written by items.
- **Player** `st_px/st_py`, `st_ply_next` (TU), `st_core_hp` (0..CORE_MAX 40),
  `st_energy` (0..st_energy_max), regen/repair accumulators.
- **Derived stats** (written only by `prt_recalc`): `st_move_cost`, `st_regen`,
  `st_energy_max`, `st_sight`, `st_acc_bonus`, `st_evade`, `st_repair_turns`.
- **Game** `st_game_state` (GAME_TITLE/PLAY/DEAD/WON), `st_mode` (MODE_*), `st_depth`
  (10..1), `st_depth_best`, `st_turn` (player actions), `st_time` (scheduler clock, TU),
  `st_kills`, `st_target` (enemy index or -1), `st_climb`, `st_death_cause` (EN_*),
  `st_seed`, `st_frame`.
- **Messages** `st_msg_text` MSG_COUNT 8 × MSG_LEN 64 (copied, NUL-terminated, so a
  message can contain names and numbers), `st_msg_attr[8]`, `st_msg_head`. Written only
  by `ui_msg*`.
- **Display** `st_screen`: header (100, 30, 0, 0) plus `st_cells` (3000).

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
| 13 | Rivet Gun | weapon | 1 | 12 | 3 | 2-4, range 6, energy 2, acc 70 |
| 14 | Scatter Tube | weapon | 1 | 14 | 3 | 1-6, range 4, energy 3, acc 75 |
| 15 | Pulse Rifle | weapon | 2 | 18 | 3 | 4-7, range 8, energy 4, acc 70 |
| 16 | Cutter Arm | weapon melee | 2 | 25 | 4 | 5-9, range 1, energy 1, acc 80 |
| 17 | Coil Lance | weapon | 3 | 22 | 3 | 7-12, range 9, energy 7, acc 65 |
| 18 | Ram Hammer | weapon melee | 3 | 35 | 4 | 8-14, range 1, energy 2, acc 75 |
| 19 | Scrap Plating | utility armor | 1 | 30 | 6 | -1 damage to itself |
| 20 | Hex Armor | utility armor | 2 | 50 | 8 | -2 damage to itself |
| 21 | Optic Mast | utility sensor | 1 | 8 | 1 | +3 sight |
| 22 | Patch Drone | utility repair | 2 | 10 | 1 | 1 integrity every 3 turns |
| 23 | Aim Gyro | utility target | 2 | 10 | 1 | +15% accuracy |

Starting loadout: 2× Stub Legs, Cell Pack, Rivet Gun, Spark Prod. That gives move 100,
energy 40, regen 3. Five slots filled, so the core-hit chance is 10 + 3×8 = 34%.

## Enemy table

Depth range: a type spawns on depths ET_DHI down to ET_DLO (10 = deepest, start).

| id | Name | Glyph | HP | Step TU | Atk TU | Damage | Range | Acc | AI | Depths | Sight | Drop % | Drops (part ids) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Flit | `f` bright cyan | 6 | 50 | 60 | 1-3 | 1 | 60 | melee | 10-5 | 7 | 40 | 7, 3, 13, 21 |
| 2 | Scuttler | `s` yellow | 12 | 100 | 100 | 2-5 | 1 | 70 | melee | 10-4 | 6 | 50 | 1, 12, 19, 9 |
| 3 | Rifler | `r` bright red | 14 | 100 | 100 | 2-5 | 6 | 60 | ranged | 9-1 | 8 | 50 | 13, 14, 15, 9, 2 |
| 4 | Watcher | `W` magenta | 20 | — | 100 | 3-6 | 8 | 65 | turret | 8-1 | 8 | 60 | 15, 23, 10, 21 |
| 5 | Bulwark | `B` bright white | 40 | 150 | 120 | 5-10 | 1 | 70 | melee | 6-1 | 6 | 70 | 5, 6, 20, 18, 16 |
| 6 | Stalker | `k` bright magenta | 22 | 60 | 80 | 4-8 | 7 | 70 | ranged | 4-1 | 10 | 60 | 8, 17, 11, 4, 22 |
| 7 | Tinker | `t` green | 8 | 80 | — | — | 0 | — | worker | 10-1 | 6 | 80 | 19, 21, 22, 23, 9 |

Per floor: SPAWN_BASE 4 + (11 − depth)/2 hostile robots (types eligible for the depth,
weighted by ET_WEIGHT), plus one Tinker. None spawn in the start room or within
SPAWN_SAFE 6 tiles of the player.

## Turn system

- One clock `st_time` in TU, where TIME_TURN = 100 TU is one normal action. The
  player acts when `st_ply_next ≤ E_NEXT` of every enemy (ties go to the player).
- A player action adds its cost to `st_ply_next` (`ply_spend`). Costs:
  - move = `st_move_cost`
  - melee TIME_MELEE 100, fire TIME_FIRE 100, wait 100, pick up 100, stairs 100
  - attach/detach TIME_SWAP 150, drop 50
  - menus, targeting, help and blocked moves cost nothing
- Move cost is the average P_M_COST of the attached propulsion parts, +LIMP_EXTRA 30
  with only one, and CRAWL_COST 250 with none.
- `act_run` then lets enemies act in E_NEXT order while `E_NEXT < st_ply_next`. Each
  enemy action adds ET_SPEED for a step, ET_ATK_TIME for an attack, or TIME_WAIT. Then
  `st_time = st_ply_next`. When the clock reaches TIME_REBASE (16384), act_run
  subtracts it from every time cell, so 16-bit math never overflows.
- `prt_tick(elapsed)`: each full TIME_TURN elapsed gives `st_energy += st_regen`
  (capped). With a repair part, every `st_repair_turns` turns it repairs 1 integrity on
  the most damaged attached part, or the core if no part is damaged.
- The player does at most one action per frame. Remaining keys wait for the next frame.
  Idle frames only redraw.

## AI

Distance field: `act_run` runs a BFS from the player over `dun_walkable` tiles once per
player action (private to actors, 1536 words + queue).

- **Sighting:** an enemy sees the player when the distance is ≤ ET_SIGHT and `fov_los`
  is clear. It enters ES_HUNT, sets E_TX/E_TY to the player, and sets E_ALERT to
  ALERT_TURNS. The first sighting while the enemy is on a visible tile posts
  "<Name> spotted.".
- **Losing the player:** a hunting enemy that can't see the player walks toward
  E_TX/E_TY. E_ALERT counts down, and at 0 it goes back to ES_IDLE.
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
- **Fire** (`f` … `f`): every weapon slot with P_W_MELEE 0, P_W_RANGE ≥ distance, LOS,
  and P_W_ENERGY available fires in slot order. Each shot spends energy, rolls to hit
  and does rand(DMIN..DMAX). If nothing can fire, no time passes ("Nothing can fire.").
- **Melee** (bump into a robot): every melee weapon slot swings (each spends its energy
  if available, else is skipped). With none, the core rams for 1-3 at 70%.
- **Damage to the player** (`prt_damage`): the core is hit with chance CORE_HIT_PCT 10
  + CORE_HIT_EMPTY 8 × empty slots. Otherwise one attached part is picked, weighted by
  P_COVER. Armor parts reduce damage to themselves by P_U_VALUE (min 1). A part at 0
  integrity is destroyed: slot emptied, "<Part> destroyed!" in A_BAD, derived stats
  recomputed. Core at 0 means GAME_DEAD, with st_death_cause = attacker type.
- **Robots:** have plain hp. At 0: "<Name> destroyed.", st_kills++, ET_DROP_PCT chance
  to drop one random part from ET_DROP at 50–100% integrity on its tile (or nearby),
  record freed.
- **Score** = (10 − shallowest depth reached) × 100 + kills × 10, + 1000 for reaching
  the surface (winning sets st_depth_best = 0, so all 10 depths count).

## Memory budget (words)

| Item | Words |
|---|---|
| display block 100x30 | 3004 |
| map + fov 2 × 1536 | 3072 |
| actors distance field + BFS queue (private) | 3072 |
| enemies 24×16, items 32×4, slots/inv 24, rooms 48 | ~590 |
| messages 8×64 + 9 | ~521 |
| other state | ~60 |
| part catalog 23×16 + names, robot types 7×16 + names + drop lists | ~800 |
| code (estimate) | 12–18K |
| **total estimate / budget.words** | **~24–30K / 40000** |

WP0 skeleton: 8,510 words (7,211 of them state + display).

## Modules

Contracts are authoritative in each file's `;;` lines (`node tools/lccgame.js api
games/scrap`). Calling convention everywhere: args r0..r4, result r0, everything else
preserved.

| File | Prefix | Owner | Responsibility | Public API | Domain skill |
|---|---|---|---|---|---|
| main.ap | main_ | architect | flow, frame loop, new game/floor, climbing, turn sequencing | main_start main_new_game main_new_floor main_turn | lcc-architect |
| src/defs.ap | — | architect | constants, record layouts, regions, palette, keys, tuning | — | lcc-architect |
| src/state.ap | st_ | architect | all shared state | data | lcc-architect |
| src/dungeon.ap | dun_ | WP1 | generator, tiles, walkable/opaque, random floor, distance | dun_generate dun_get dun_set dun_walkable dun_opaque dun_random_floor dun_room_of dun_dist | lcc-simulation |
| src/fov.ap | fov_ | WP2 | visibility + memory, line of sight | fov_reset fov_update fov_visible fov_known fov_los | lcc-simulation |
| src/parts.ap | prt_ | WP3 | catalog, slots, inventory, derived stats, energy, repair, damage spread | prt_init prt_recalc prt_info prt_name prt_kind prt_slot_kind prt_attach prt_detach prt_inv_add prt_inv_clear prt_damage prt_tick prt_spend_energy prt_random_part prt_free_slots | lcc-simulation |
| src/ui.ap | ui_ | WP4 | panel, bars, messages, help row, menus, help overlay, title/end screens | ui_init ui_title ui_draw ui_end_screen ui_msg ui_msg_add ui_msg_addn ui_msg_attr ui_bar ui_score | lcc-text-graphics |
| src/render.ap | ren_ | WP5 | map viewport layers | ren_draw ren_tile_cell | lcc-text-graphics |
| src/items.ap | itm_ | WP6 | floor item pool, per-floor loot | itm_clear itm_place itm_at itm_remove itm_spawn_floor | lcc-simulation |
| src/actors.ap | act_ | WP7 | robot types, pool, spawning, scheduler, AI, target cycling | act_init act_clear act_spawn_floor act_spawn act_at act_run act_think act_type_info act_name act_kill act_next_visible | lcc-simulation |
| src/combat.ap | cbt_ | WP8 | hit chance, fire, melee, enemy attacks, destruction, drops | cbt_hit_chance cbt_player_fire cbt_player_melee cbt_enemy_attack cbt_damage_enemy | lcc-simulation |
| src/player.ap | ply_ | WP9 | input modes, player actions | ply_init ply_handle ply_key ply_move ply_spend ply_pickup ply_equip ply_remove ply_drop ply_target ply_fire ply_stairs | lcc-game-dev |

Dependency direction (who calls whom): main → everything. player → dungeon, items,
parts, actors, combat, ui. actors → dungeon, fov, combat, ui. combat → parts, items,
actors, dungeon, fov, ui. parts → ui (destroyed messages). items → dungeon, parts.
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

`millis` → `st_seed` → `srand` once at start. Every generator uses `rand`, so a run is
reproducible in the headless harness for a given `--clock`.

## Open questions

- Whether the core alone (no weapons) should get a free weak ranged zap. For now the
  answer is no: a weaponless core can only ram.
- Whether doors need closing: no close command in v1.
- Balance (spawn counts, drop rates, energy costs) is WP10's job once the game is
  playable.
