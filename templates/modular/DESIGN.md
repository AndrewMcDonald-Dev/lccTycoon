# <Game title> — design

Owner: architect. The orchestrator approves changes; modules follow it.

## Pitch
One paragraph: what the player does and why it is fun.

## Scope
- In (this version): ...
- Out (explicitly not doing): ...

## Screen layout (100x30)
```
+------------------------------------------------------------------+---------------------------------+
| viewport  rows 0-23, cols 0-63                                   | side panel rows 0-23, cols 64-99|
+------------------------------------------------------------------+---------------------------------+
| status bar row 24 | message log rows 25-28 | key help row 29                                      |
+------------------------------------------------------------------------------------------------------+
```
Region rectangles are `.define`s in `src/defs.ap` (VIEW_*, PANEL_*, STATUS_*, ...).

## Controls
| Key | Action |
|---|---|

## Data model
All shared constants in `src/defs.ap`, shared state in `src/state.ap`.
- Grids: size, word layout (bit fields), who writes them.
- Record tables: name, MAX, SIZE (power of two ≤ 32), fields with units and ranges.
- Scalars: money representation, calendar, flags.

## Memory budget (words)
| Item | Words |
|---|---|
| display block 100x30 | 3004 |
| ... | |
| code (estimate) | |
| total / budget.words | / |

## Modules
| File | Prefix | Responsibility | Public API (authoritative: `;;` lines, `lccgame api`) | Domain skill |
|---|---|---|---|---|

## Frame loop & timing
FRAME_MS, what runs every frame vs every N frames, instruction budget per frame.

## Open questions
