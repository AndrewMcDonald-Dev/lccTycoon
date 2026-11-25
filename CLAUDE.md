# lccTycoon — games in LCC+ assembly, built by agents

An environment for writing terminal games in **LCC+ assembly** (`.ap`), the game-capable
extension of the LCC 16-bit educational ISA, on the vendored
[lccjs](https://github.com/avidrucker/lccjs) toolchain, with a headless harness so agents
can see and test what they build. Node ≥18 only; no npm install needed.

## Skills (load with the Skill tool before working)

| Skill | Who loads it |
|---|---|
| `lcc-orchestrator` | The one agent coordinating a multi-agent game build (dispatching WPs, integrating) |
| `lcc-architect` | Subagents doing skeletons, DESIGN/WORKPLAN, defs/state, API changes |
| `lcc-text-graphics` | Subagents doing rendering, UI, menus, art |
| `lcc-simulation` | Subagents doing entities, AI, economy, pathfinding, numeric code |
| `lcc-qa` | Subagents doing tests, reviews, playtests, perf audits |
| `lcc-game-dev` | **Every** agent that touches game code: harness, template, module rules, hand-back report |
| `lccplus-assembly` + `lccjs-assembly` | **Every** agent that writes assembly: the language and its pitfalls |

If the Skill tool says a skill is unknown (skills register when a session starts), Read
`.claude/skills/<name>/SKILL.md` directly. The routing table (task type → skills) and the subagent brief template are in
`lcc-orchestrator`. Subagents should be `general-purpose` agents (they need the Skill tool).

## Building a game with agents

1. Start (or open) `games/<name>/DESIGN.md` + `WORKPLAN.md` — templates in
   `templates/modular/`; `games/park/` already has both for the theme-park game.
2. The orchestrating session loads `lcc-orchestrator` and runs the loop: dispatch a wave of
   work packages (2–4 parallel subagents, disjoint files) → collect hand-back reports →
   `node tools/lccgame.js check` → QA review → update WORKPLAN.md → next wave.

## Commands

```bash
node tools/lccgame.js help
node tools/lccgame.js new <name> [--modular]                # scaffold games/<name>/
node tools/lccgame.js build games/<name> [--map|--symbols|--listing|--verbose]
node tools/lccgame.js run   games/<name> --keys "d d _3 q" --show changed --watch "st_cash_k" [--colors] [--profile]
node tools/lccgame.js test  [games/<name>]
node tools/lccgame.js check                                 # integration gate: build all + test all
node tools/lccgame.js api   games/<name> [--lib]            # module contracts (';;' lines)
node tools/lccgame.js glyphs                                # display glyph codes
node tools/lccgame.js play  games/<name>                    # humans only (real TTY)
node tools/selftest.js                                      # harness: fast core == upstream semantics
cd server && npm install && npm start                       # SCRAPCORE SSH versus server (port 2222; npm test for tests)
```

## Layout

- `games/<name>/` — one game: `game.json` (modules, prefixes, owners, skills, budget),
  `DESIGN.md`, `WORKPLAN.md`, `main.ap`, `src/*.ap`, `tests/*.test.json`, `tests/unit/`.
  `games/lemonade/` is a finished single-file example; `games/park/` is the theme-park
  game in progress (design, work plan, WP0 skeleton done; wave 1 next).
- `lib/*.ap` — stdlib: `video_defs` + `video` (display blocks), `util`, `term`, `draw`;
  tests in `lib/tests/`.
- `templates/simple`, `templates/modular` — what `new` copies.
- `tools/` — the harness (Node): `lccgame.js` CLI; `lib/assemble.js` (.include/.define,
  error collection, far-reference relaxation, game.json lint), `lib/headless.js`
  (deterministic runner), `lib/fastcore.js` (fast interpreter step), `lib/display.js`
  (`present` trap, CP437), `lib/farops.js`, `lib/player.js` (interactive), `lib/vterm.js`,
  `lib/keys.js`, `lib/expr.js`; harness tests in `tools/tests/`.
- `server/` — SCRAPCORE SSH versus-race server (Node + `ssh2`): `server.js` (SSH server, auth, no shell/exec/sftp/forwarding), `room.js` (lobby, countdown, standings, rival HUD), `vm.js` (per-player LCC+ VM), `text.js` (UI copy), `README.md` (host guide); tests in `server/test/`.
- `vendor/lccjs/` — upstream toolchain snapshot (`vendor/VENDORED.md`); read-only reference.
  Its `CLAUDE.upstream.md` is about contributing to lccjs and does not apply here.

## Rules

- Never run `vendor/lccjs/src/plus/lccplus.js` or `lccgame.js play` from an agent shell —
  they need a real TTY and loop forever. Use `run` / `test`.
- `check` must be green before and after every wave of agent work.
- A game change is done when its tests pass and the frames for the behavior were looked
  at with `run --show changed`.
- Harness changes (tools/) must keep `check` and `node tools/selftest.js` green.
