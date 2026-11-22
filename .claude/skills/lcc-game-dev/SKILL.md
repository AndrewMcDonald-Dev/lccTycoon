---
name: lcc-game-dev
description: Core workflow for any agent that writes or changes LCC+ assembly in this repo — building, running headless, seeing frames, reading memory, writing scenario/unit tests, using the lib/ stdlib, and the module rules of the modular game template (game.json, src/ modules, prefixes, unit drivers, hand-back report). Load for every code task on a game under games/; pair with lccplus-assembly + lccjs-assembly (language) and a domain skill (lcc-text-graphics, lcc-simulation, lcc-architect, lcc-qa) as the brief says.
---

# LCC+ game development (harness + module workflow)

You cannot play a game from an agent shell. `tools/lccgame.js` runs the real lccjs
interpreter **headless and deterministically**: scripted keys in, every frame captured from
a virtual 30x100 terminal, labeled memory readable. Never run `lccplus.js` or `lccgame.js
play` (they need a TTY and loop forever).

## Commands

`<target>` = game directory (with `game.json`), a `game.json`, or an `.ap` file.

```bash
node tools/lccgame.js build <target> [--map] [--symbols] [--listing] [--verbose]
node tools/lccgame.js run   <target> --keys "d d _3 q" [--show changed] [--watch "a,b:4,s:s"] [--colors] [--profile]
node tools/lccgame.js test  <dir or file ...>     # scenario + unit tests under it
node tools/lccgame.js check                       # build every game + every test: the integration gate
node tools/lccgame.js api   <target> [--lib]      # every module's public contract (';;' lines)
node tools/lccgame.js glyphs                      # code-page-437 glyph codes for display cells
node tools/lccgame.js new <name> [--modular]      # scaffold a game
```

## The modular game template (what every game looks like)

```
games/<name>/
  game.json          title, entry, size "30x100", budget.words, modules{file: {prefix, owner, description, skills}}
  DESIGN.md          design + data model + module/API plan        (owner: architect)
  WORKPLAN.md        work packages, status, acceptance tests       (owner: orchestrator)
  main.ap            entry + frame loop; includes defs at top, modules, then lib at the end
  src/defs.ap        .define constants only: sizes, struct field offsets, colors, keys (architect)
  src/state.ap       all shared state as labeled data, prefix st_ (architect)
  src/<module>.ap    one owner each; every label starts with the module prefix
  tests/*.test.json  whole-game scenarios
  tests/unit/<module>_driver.ap + <module>.test.json   module tested in isolation
```

Build rules enforced by `build`/`check`: every label in a listed module starts with its
`prefix` (a module with `"prefix": []` may define no labels — defines only); every listed
module must be included; total words ≤ `budget.words`.

**Public API = `;;` lines.** Each module's header lists its public routines, one per line:
`;; mod_name  r0=x r1=y -> r0=result  what it does`. `api` prints them for the whole game;
treat them as the contract. Calling convention for every public routine (same as `lib/`):
**args r0..r4, result r0, all other registers preserved, `bl` to call.**

## Build features (preprocessor + assembler)

- `.include "file"` — relative to the including file, then `lib/`; each file once.
- `.define NAME expr` — UPPER_CASE integer constants; usable in any operand, with
  `+ - * / % << >> & | ^ ~ ( )`, `'c'` chars, `0x..`: `str r2, r0, COLS+2`,
  `.zero MAP_W*MAP_H`, `.word G_BLOCK|FG_GREEN`. Define before use (defs at top).
- `.pstring "text"` — 2-chars-per-word packed NUL-terminated string, expanding to `.word`
  entries `(c0 << 8) | c1` (odd length ends with `(last << 8) | 0`, even length appends
  `0x0000`; escapes `\n \r \t \\ \" \' \0`).
- **Far references are automatic**: `bl`, `br*`, `ld`, `st`, `lea` whose target is beyond
  PC-relative reach are rewritten into far forms (registers and flags preserved; costs a few
  words — `build --verbose` lists them). You do *not* need pointer cells for reach any more.
  Immediates are still narrow: `mov` −256..255, `add/sub/cmp/and` −16..15, `ldr/str` offset
  −32..31 → load bigger constants from a `.word` cell.
- Every error is reported at once as `file:line` with a `hint:` line.
- Project ISA extensions (also in the lccplus-assembly skill): `present rN` (draw a display
  block), `farcall`/`farjump` (inserted by the build).

## Time, frames and input

- Virtual clock: `sleep rN` advances rN ms instantly; 1 µs per instruction; `millis` reads
  it → runs are reproducible (`--clock N` varies the seed).
- **Frame boundary** = every `sleep`; 64 consecutive empty `nbain` polls; a blocking read
  (`ain/din/sin`) needing input. Each boundary snapshots the screen.
- **Key script**, one token per frame: `d` · `wd` (both, same frame) · `_`/`_5` empty frames ·
  `d*4` · `42<enter>` · named `<up> <down> <left> <right> <space> <enter> <esc> <tab> <bs>
  <lt> <star> <us> <hash> <NN>`. Arrows arrive as 27,91,65..68 through `nbain`.
- Stops at halt, last token + `--tail` (1) frames, `--frames N`, `waiting-for-input`, or
  `step-limit` (2M instructions in one frame ⇒ infinite loop / missing `sleep`).

## Seeing what happens

| Option | Use |
|---|---|
| `--show final` / `all` / `changed` / `0,5,9` | frame snapshots to print |
| `--watch "cash,guests:4,name:s"` | labeled memory at each shown frame + end |
| `--colors` | fg and bg color maps (`k r g y b m c w`, uppercase = bright, `.` default) |
| `--profile` | instructions per frame by module and routine — performance work |
| `--json` | everything machine-readable |
| `build --map` | words per module vs budget; `--symbols` labels + defines; `--listing` addresses |

On `runtime-error`/`step-limit` you get the PC's `file:line`, registers and hottest lines.

## Tests

Scenario file (`tests/*.test.json`; `game` defaults to the game directory above `tests/`):

```json
{ "scenarios": [
  { "name": "placing a path costs $10", "keys": "1 <space>",
    "expect": { "memory": { "st_cash_lo": 990 }, "screen": { "contains": ["Path"] } } },
  { "name": "title", "frames": 1, "expect": { "status": "frames-complete",
    "screen": { "lines": { "0": "..." } }, "colors": { "lines": { "0": "yyyy" } } } }
] }
```

Per scenario: `keys frames tail clock size maxFrameSteps watch`. `expect`: `status`
(string|list), `screen`/`colors`/`bg` {`contains notContains matches lines equals`},
`memory` {label: n | [n..] | "string"}, `frames` [{`frame`, `screen`, `colors`}],
`sounds`, `maxSteps`, `maxStepsPerFrame`. Memory compares as signed 16-bit.

**Unit drivers** test one module while the rest of the game may be broken: a tiny `.ap` in
`tests/unit/` that includes `video_defs.ap`, `src/defs.ap`, `src/state.ap`, the module
under test (plus any module it calls, or a stub file of your own in `tests/unit/`), sets up
state, calls routines, stores results in `drv_*` cells, and halts. See
`templates/modular/tests/unit/` for the pattern.

## Stdlib (`lib/`)

| File | Use |
|---|---|
| `video_defs.ap` (top) + `video.ap` (end) | **display-block drawing — the default for real games**: `video_bind present clear put get addr text num fill box` with FG_/BG_/G_ constants |
| `util.ap` | `util_print_padded util_print_fixed2 util_memset util_memcpy util_strlen util_abs util_min util_max` |
| `term.ap`, `draw.ap` | streaming ANSI output (cursor moves + text); fine for small games |

`node tools/lccgame.js api <game> --lib` prints every signature.

## Working as a subagent on a module

1. Read the brief, `DESIGN.md`, and `api <game>` output. Load the skills the brief names.
2. Edit **only the files your brief assigns** (your module(s), their unit tests). Never edit
   `src/defs.ap`, `src/state.ap`, `game.json`, `main.ap` or another module unless the brief
   says so — if you need a new constant, state cell or API, stop and report it as a request.
3. Keep your module's `;;` contract lines accurate; follow the calling convention exactly.
4. Iterate with your unit driver; then `test games/<name>` for the whole game; look at
   frames (`run --show changed`) for every behavior you touched.
5. Hand back with this report (the orchestrator parses it):

```
WP: <id>   STATUS: done | partial | blocked
FILES: <files changed>
API: <;; lines added/changed, or "unchanged">
TESTS: <test command + summary line>     CHECK: <check summary line, or why not run>
REQUESTS: <needed changes to defs/state/other modules, or "none">
NOTES: <risks, follow-ups, perf numbers from --profile if relevant>
```
