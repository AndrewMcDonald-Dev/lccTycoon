---
name: lcc-orchestrator
description: For the single orchestration agent that builds a large LCC+ game by delegating to subagents. Covers reading DESIGN.md/WORKPLAN.md, choosing which work packages run in parallel, writing subagent briefs that name the right skills for each task, the integration gate, review/fix loops, and keeping the plan current. Load this when you are asked to build or advance a game under games/ by coordinating other agents, not when you are a subagent.
---

# Orchestrating a multi-agent LCC+ game build

You are the only agent that sees the whole picture. Subagents start fresh: they know only
your brief and the skills you tell them to load. You keep `WORKPLAN.md` true, run the
integration gate, and decide what happens next. You write little game code yourself —
small fixes after a review, yes; whole modules, no.

## Inputs you own

- `games/<name>/DESIGN.md` — what the game is, data model, module/API plan (written by an
  architect subagent; you approve it).
- `games/<name>/WORKPLAN.md` — work packages (WPs): files owned, dependencies, skills,
  acceptance tests, status `todo | active | review | done | blocked`, and a log line per
  attempt. Format: `templates/modular/WORKPLAN.md`. **Update it after every dispatch and
  every hand-back.**
- `game.json` — module → prefix / owner / skills. Set `owner` to the WP id when you
  dispatch.

## Skill routing (put the exact list in every brief)

| Task type | Skills the subagent must load |
|---|---|
| Architecture: game.json, `defs.ap`, `state.ap`, stubs, API contracts, interface changes | `lcc-architect`, `lcc-game-dev`, `lccplus-assembly`, `lccjs-assembly` |
| Rendering, UI panels, menus, text, art/palette, title screens | `lcc-text-graphics`, `lcc-game-dev`, `lccplus-assembly`, `lccjs-assembly` |
| Simulation: entities, AI, needs, economy, calendar, pathfinding, RNG, numeric code | `lcc-simulation`, `lcc-game-dev`, `lccplus-assembly`, `lccjs-assembly` |
| Input handling, tools/commands, glue between modules | `lcc-game-dev`, `lccplus-assembly`, `lccjs-assembly` |
| Tests, playtesting, code review, performance audit | `lcc-qa`, `lcc-game-dev`, `lccjs-assembly` |
| Harness / JavaScript tooling under `tools/` | none of the above; read `CLAUDE.md` and `tools/` (rare — keep `npm test` + `tools/selftest.js` green) |

Skills are registered when a Claude Code session starts: after skills are added or
edited, start a new session (or tell subagents to Read `.claude/skills/<name>/SKILL.md`,
which the brief template already does as a fallback).

A WP that spans two domains (e.g. a ride module with its own info window) gets both domain
skills.

## The loop

1. **Bootstrap** (once): if there is no `DESIGN.md`/`WORKPLAN.md`, dispatch an architect to
   write them from the user's goal (templates in `templates/modular/`), then WP0 = the
   walking skeleton: `game.json`, `main.ap`, `defs.ap`, `state.ap`, and a stub for every
   module with its `;;` contract, so that `check` passes and the game runs from day one.
2. **Pick a wave**: every `todo` WP whose dependencies are `done`, whose owned files don't
   overlap any `active` WP, and that doesn't change `defs.ap`/`state.ap`. Run 2–4 in
   parallel; more makes integration noisy. Interface changes (defs/state/API) are their
   own small architect WP and run alone.
3. **Dispatch** each WP with the brief template below. Run parallel subagents in the same
   working tree (file ownership keeps them apart; each tests through its unit driver). If
   the repo is a git repo you may use worktree isolation instead, then merge.
4. **Collect** each hand-back report (format in `lcc-game-dev`). Copy STATUS/TESTS/REQUESTS
   into the WP log.
5. **Integrate**: after a wave, run `node tools/lccgame.js check` yourself. Green → mark WPs
   `review`. Red → find the owning WP from the failing file/test, re-dispatch it with the
   failure output (or fix a one-liner yourself).
6. **Review**: for non-trivial WPs dispatch a QA subagent (`lcc-qa`) with the WP's acceptance
   criteria and the files — give it the code and criteria, not your opinion of it. Fix
   findings via the owning WP. Then mark `done`.
7. **Requests**: collect REQUESTS from reports into one architect WP (defs/state/API change)
   before the next wave that needs them.
8. Repeat. Every few waves dispatch a QA playtest WP across the whole game, and check
   `build --map` against the memory budget.

## Brief template (fill every field — the subagent knows nothing else)

```
You are implementing <WP id>: <title> for the LCC+ game in games/<name>/.
Load these skills first (Skill tool): <list from the routing table>. If the Skill tool
says a skill is unknown, Read .claude/skills/<name>/SKILL.md directly instead.
Read: games/<name>/DESIGN.md (sections: <...>), and this API summary:
<paste output of: node tools/lccgame.js api games/<name>>

You own (edit only these): <files>. Do not edit defs.ap, state.ap, game.json, main.ap or
other modules; report needed changes under REQUESTS.
Goal: <behavior, in player-visible terms and in state terms>
Contract to implement: <;; lines, exact registers>
State you may read/write: <st_ labels / defines>
Acceptance: <tests that must exist and pass; e.g. tests/unit/foo.test.json covering X, Y;
games/<name> tests stay green; specific --profile budget if relevant>
Hand back with the report format from the lcc-game-dev skill.
```

## Rules of thumb

- Sizing: one WP ≈ one module or one feature, roughly 150–500 lines of assembly, testable
  by itself. Split anything bigger.
- Contracts first: a WP never starts until the routines it calls exist at least as stubs
  with `;;` lines.
- Only one WP touches a file at a time. Tests follow the same rule: each WP owns its own
  `tests/<wp-topic>.test.json` and `tests/unit/<module>_*`. The shared
  `tests/smoke.test.json` belongs to the architect; a WP that replaces a placeholder the
  smoke test pins may update exactly those expectations and must say so in its report. `defs.ap`/`state.ap` changes are serialized through
  architect WPs.
- Keep `check` green between waves; never start a wave on a red tree.
- Track budgets: words (`build --map`), instructions per frame (`run --profile`). The fast
  player runs ~100M instr/s → ≤ 2–4M instructions per 50 ms frame is comfortable.
- When a subagent fails twice on the same WP, shrink the WP or have an architect revisit the
  contract. Don't just re-send the same brief.
- Report progress to the user in terms of WPs done, tests passing, and what the game can do.
