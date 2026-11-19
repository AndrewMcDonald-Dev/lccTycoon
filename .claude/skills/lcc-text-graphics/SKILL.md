---
name: lcc-text-graphics
description: For subagents that draw things in an LCC+ game — map/world viewports, sprites/entities, UI panels, status bars, menus, windows, title screens, color/glyph art direction — using the text-mode display block (`present` trap, lib/video.ap, code-page-437 glyphs, 16 colors). Covers layout, fast rendering loops, scrolling, cursors, animation, and how to verify visuals headlessly. Load for any rendering/UI work package.
---

# Text-mode graphics for LCC+ games

The "screen" is a grid of character cells (default 100 columns × 30 rows). Each cell is one
word: `glyph | FG<<8 | BG<<12` (constants in `lib/video_defs.ap`: `G_*`, `FG_*`, `BG_*`).
A game builds the whole frame in a **display block** in memory and calls `present` once
per frame; in a real terminal only changed cells are redrawn, so full redraws are cheap.

```
st_screen: .word 100        ; cols      (header: 4 separate .word lines)
           .word 30         ; rows
           .word 0          ; top row on the terminal
           .word 0          ; left column
st_cells:  .zero 100*30
```

`video_bind` it once at startup; the main loop calls `video_present` after all drawing.

## Glyphs and colors

- `node tools/lccgame.js glyphs` prints all 256 glyphs. Workhorses: `░▒▓█` 176–178/219,
  half blocks `▀▄▌▐` 223/220/221/222, `■` 254, `·` 250, box drawing single
  `┌┐└┘─│├┤┬┴┼` and double `╔╗╚╝═║`, `☺☻` 1/2 (people), `♣` 5 (trees), `♠` 6, `♥♦` 3/4,
  `≈` 247 (water), `⌂` 127 (buildings), arrows 24–27, triangles 16/17/30/31, `☼` 15.
- 8 colors + 8 bright: black red green yellow blue magenta cyan white. Attribute 0 = the
  terminal's default colors (good for plain text). Background colors read as solid fills:
  grass = `G_SPACE|BG_GREEN` or `'.'|FG_GREEN`; water `247|FG_BCYAN|BG_BLUE`.
- Readability: one meaning per color; high contrast for interactive things (cursor,
  selection, warnings); dim (`FG_GRAY`) for inactive text. Keep the palette in `defs.ap`
  (e.g. `.define COL_PATH G_MEDIUM|FG_WHITE`) so it is tunable and consistent.

## Layout

Agree regions with the architect and put them in `defs.ap` as defines (e.g. viewport
`VIEW_ROW VIEW_COL VIEW_ROWS VIEW_COLS`, side panel, status bar, message log). Each module
draws only inside its region. Draw order inside a frame: background/world → entities →
cursor/selection → panels → popups/windows last.

## Drawing API (lib/video.ap)

`video_put/get/addr` (clipped, 0-based row/col), `video_text` (string | attr),
`video_num` (signed decimal), `video_fill` (rect), `video_box` (single-line outline),
`video_clear` (whole block, fast). Exact signatures: `node tools/lccgame.js api <game> --lib`.
Overwrite fixed-width fields every frame (`video_fill` the field, then text/num) so stale
digits never remain.

## Fast loops for big areas

`video_put` costs ~25 instructions per cell; a 64x24 viewport redrawn through it is ~40K
instructions — fine, but tile maps are better drawn directly:

```
        ; r0 = map row, r1 = screen row; draw VIEW_COLS tiles of map row into the screen row
        mov r2, 0                  ; screen column 0 of the viewport
        ... r3 = address of map[row][view_x], r4 = video_addr(screen_row, VIEW_COL)
ren_row_lp:
        ldr r2, r3, 0              ; tile word
        and r2, r2, T_KIND_MASK    ; (mask ≤ 15 fits imm5; else and with a register)
        ... look up cell = ren_tile_cells[kind] (lea table + add + ldr)
        str r2, r4, 0              ; write the display cell
        add r3, r3, 1
        add r4, r4, 1
        ...loop VIEW_COLS times
```

≈8–12 instructions per cell. Use lookup tables (`.word` arrays indexed by kind) instead of
compare chains. Profile with `run --profile` and keep rendering ≲ 200K instructions/frame.

## Scrolling viewports, cursors, animation

- Keep `view_x/view_y` in state; clamp so the viewport stays inside the map; scroll when the
  cursor gets within N tiles of an edge.
- Cursor: redraw the cell under it with an inverted attribute (e.g. `FG_BLACK|BG_BYELLOW`
  with the same glyph) — compute from the cell already written.
- Animate from a frame counter (`st_frame`): `and r0, r0, 7` gives a 0..7 phase; blink with
  bit 3; walking entities alternate glyphs.
- Entities on a map: draw after the terrain pass; convert world → screen
  (`sx = x - view_x + VIEW_COL`) and skip if outside the viewport.

## Text-heavy UI

Strings live next to the routine that draws them. Menus: an array of string pointers
(`.word s_opt1` …) + a selected index; highlight the selected row with a background color.
Windows/popups: `video_fill` a background, `video_box`, then text. Numbers: `video_num`; for
money or fixed-width fields fill the field first.

## Verifying visuals headlessly

- `run --show changed` shows each new frame; `--colors` shows fg/bg maps under it.
- Tests: `screen.lines` for exact rows, `contains` for labels, `colors`/`bg` `.lines` to
  pin the palette of key rows (cursor highlight, warnings), `frames[]` to check animation
  phases. Test a few representative rows — not the whole screen — so art tweaks don't
  break every test.
- In the real terminal (`play`, humans only) CP437 glyphs come out as Unicode; keep
  important information readable even without color.
