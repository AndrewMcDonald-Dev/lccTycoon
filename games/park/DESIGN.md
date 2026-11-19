# Park Builder (working title) — design

Owner: architect. The orchestrator approves changes. This is an **original** theme-park
management game in the tycoon genre: our own name, layout, ride roster, art and text. It is
not a recreation of any existing game, so don't copy names, art, ride names, scenarios or UI
from one.

## Viability (why this scope)

| Constraint (LCC+ on lccjs) | Consequence for the design |
|---|---|
| 16-bit words, 64K-word address space (code + data + stack) | Map 64x48 tiles, ≤128 guests, ≤32 rides/stalls, fixed pools, program budget 48K words |
| 8 registers (5 scratch), no multiply-by-constant tricks beyond `sll`, 16-bit `mul/div` | Power-of-two record sizes, table-driven logic, money as thousands + units |
| ~100M instructions/s on the project's fast player (~5M/s on upstream lccjs) | ~5M instructions per 50 ms frame; target ≤ 2M; time-slice guests; BFS only when the map changes |
| Display = 100x30 character cells, 16 colors, code-page-437 glyphs | Top-down tile map (no isometric art), 1 cell per tile, colored glyphs for terrain/rides/people |
| Keyboard only, no mouse | Cursor-driven building with tool keys |
| No file I/O, 7 fixed sound slots | No save games in v1; sounds for events only |
| Single assembly unit (no linker) | Modules via `.include`, labels prefixed per module, far references handled by the build |

Verdict: a full genre game is viable at terminal scale. Paths, flat rides and stalls,
guests with needs and money, finances, park rating, staff, and a grid-based coaster
designer with excitement/intensity/nausea ratings all fit the memory and speed budgets
above. Out of reach: isometric bitmap graphics, thousands of guests, physics-accurate
train simulation, mouse UI, save files. Estimated size: 10–15K lines of assembly, about
16 work packages, 6–8 waves of 2–4 parallel subagents.

## Pitch

Build a theme park on an empty valley. Lay paths from the gate, place rides and food
stalls, set prices, and keep guests happy enough to keep coming. Design your own roller
coaster on the grid, tune its thrills, and hit the scenario's goal (e.g. 60 guests in the
park and rating ≥ 600 by the end of year 2).

## Scope

- In: terrain (grass, trees, water), paths and queues, 6–8 flat rides and stalls,
  ride/stall prices, open/close, guests (spawn, needs, money, decisions, queues, riding,
  buying, leaving, thoughts), economy (entry fee, income, upkeep, loan, monthly report),
  calendar, park rating, scenario goal, coaster track designer + ratings + animated train,
  staff (handymen for litter, mechanics for breakdowns), info windows, title screen, sounds.
- Out: save/load, terrain height editing, weather, marketing, research tree, multiple
  scenarios beyond 2–3 presets.

## Screen layout (100x30)

```
cols 0-63                                             cols 64-99
+----------------------------------------------------+-----------------------------------+
| VIEWPORT rows 0-23: 64x24 window onto the 64x48 map | PANEL rows 0-23: tool, cursor info,|
| (scrolls vertically to follow the cursor)          | selected ride/guest window         |
+----------------------------------------------------+-----------------------------------+
| STATUS row 24: $cash  guests  rating  date  speed  (PAUSED)                             |
| MESSAGES rows 25-28: newest 4 messages                                                  |
| HELP row 29: context key help                                                           |
+---------------------------------------------------------------------------------------+
```

## Controls (initial)

| Key | Action |
|---|---|
| w a s d / arrows | move cursor (W A S D: 5 tiles) |
| 1 path, 2 queue, 3 ride, 4 stall, 5 scenery, 6 coaster, x demolish | select tool |
| [ ] | previous / next item for the ride/stall/scenery tool |
| space | apply tool at cursor |
| i | info window for what is under the cursor |
| + - | raise/lower price of the selected ride/stall (or entry fee on the gate) |
| o | open/close the selected ride |
| f | finance window |
| p | pause, `>` speed |
| q | quit (asks to confirm) |

## Data model (to be fixed in `src/defs.ap` / `src/state.ap` by WP0)

- **Map** `st_map: .zero MAP_W*MAP_H`, MAP_W 64, MAP_H 48 (3072 words), index `y<<6 | x`.
  Tile word: bits 0-3 kind (0 grass, 1 tree, 2 water, 3 path, 4 queue, 5 park gate,
  6 ride body, 7 ride entrance, 8 ride exit, 9 stall, 10 track, 11 flowers, 12 bench,
  13 bin, 14 fence), bits 4-8 ride/stall index (0-31), bits 9-11 height (0-7), bit 14
  litter, bit 15 vomit. Masks/shifts as defines.
- **Guests** `st_guests: .zero MAX_GUESTS*GUEST_SIZE`, MAX_GUESTS 128, GUEST_SIZE 16:
  state (0 = free slot), x, y, dir, target ride, cash ($), happiness, hunger, thirst,
  energy, nausea (0..255 meters), timer, rides taken, thought code, name seed, spare.
- **Rides/stalls** `st_rides: .zero MAX_RIDES*RIDE_SIZE`, MAX_RIDES 32, RIDE_SIZE 32:
  type (0 = free), x, y, w, h, entrance x/y, exit x/y, status (closed/open/broken), price,
  queue length, riders, cycle timer, excitement, intensity, nausea (0..1000), income
  (thousands + units), total riders, reliability, age, track start index (coasters).
- **Ride types** catalog: static table in `src/rides.ap` (name, footprint, cost, capacity,
  cycle ticks, base ratings, glyph/colors, stall goods).
- **Coaster track** `st_track: .zero MAX_TRACK*TRACK_SIZE`, MAX_TRACK 256, TRACK_SIZE 4:
  x, y, height, piece (direction/shape code).
- **Staff** `st_staff: .zero MAX_STAFF*STAFF_SIZE`, MAX_STAFF 16, STAFF_SIZE 8 (`SF_*` fields).
- **Money**: thousands + units, `st_cash_k`, `st_cash_u` (0..999), likewise loan, monthly
  income/expense accumulators. Entry fee, park value.
- **Calendar**: `st_tick`, `st_day` (1..DAYS_PER_MONTH), `st_month`, `st_year`; day length
  as a define (e.g. 40 frames).
- **UI state**: cursor x/y, view y, tool, tool item, selected ride/guest, open window,
  paused, speed, message ring: 4 copied text buffers of MSG_LEN (64) words + head + age, so
  messages can contain numbers (`ui_msg`, `ui_msg_num`).
- **Display**: `st_screen` 100x30 block (3004 words).

## Memory budget (words)

| Item | Words |
|---|---|
| display block | 3004 |
| map | 3072 |
| guests 128×16 | 2048 |
| rides 32×32 | 1024 |
| track 256×4 | 1024 |
| pathfinding scratch (distance field + queue; private to src/path.ap) | 6144 |
| other state | ~500 |
| code + static data (estimate) | 15–25K |
| **budget.words** | **48000** |

## Modules

| File | Prefix | Responsibility | Domain skill |
|---|---|---|---|
| main.ap | main_ | entry, frame loop, pause/speed | architect |
| src/defs.ap | (none) | constants, record layouts, regions, palette, tuning | lcc-architect |
| src/state.ap | st_ | all shared state | lcc-architect |
| src/map.ap | map_ | terrain generation, tile get/set, walkability, area checks | lcc-simulation |
| src/render.ap | ren_ | viewport: terrain, rides, track, guests, cursor, scrolling | lcc-text-graphics |
| src/ui.ap | ui_ | panel, status bar, messages (`ui_msg`), help line | lcc-text-graphics |
| src/input.ap | inp_ | key dispatch, cursor movement, tool selection | lcc-game-dev |
| src/build.ap | bld_ | placement rules, costs, demolition, refunds | lcc-simulation |
| src/economy.ap | eco_ | money ops, calendar, upkeep, fees, loan, monthly report | lcc-simulation |
| src/rides.ap | ride_ | ride/stall catalog, records, operation cycle, queues, income | lcc-simulation |
| src/path.ap | pth_ | BFS distance fields, next-step queries | lcc-simulation |
| src/guests.ap | gst_ | spawning, needs, decisions, movement, riding/buying, leaving | lcc-simulation |
| src/windows.ap | win_ | info/finance windows | lcc-text-graphics |
| src/coaster.ap | cst_ | track designer, circuit validation, ratings, train | lcc-text-graphics + lcc-simulation |
| src/staff.ap | stf_ | handymen and mechanics | lcc-simulation |
| src/scenario.ap | scn_ | title screen, park rating (`scn_rate`), goals, win/lose | lcc-text-graphics + lcc-simulation |

## Frame loop & timing

FRAME_MS 50 (20 fps). Every frame: input, render, ui, present. When not paused, `speed`
simulation ticks per frame: calendar, rides, guests (time-sliced: 1/4 of slots per tick),
staff. Pathfinding fields recomputed only when `st_map_dirty` is set. Target ≤ 2M
instructions per frame (`maxStepsPerFrame` in the stress scenario).

## Open questions

- Coaster model: closed circuit of grid pieces with heights; ratings from drops, turns,
  length and speed estimate; train shown as moving glyphs. Decide piece set in WP12.
- Guest count vs. performance: start at 128, raise if the profile allows.
