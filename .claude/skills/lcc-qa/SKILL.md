---
name: lcc-qa
description: For subagents that test, review, playtest or performance-audit an LCC+ game — writing scenario and unit tests from acceptance criteria, scripted playthroughs with the headless harness, an assembly code-review checklist (calling convention, stack balance, flags, ranges, prefixes), and a findings report the orchestrator can act on. Load for QA, review, playtest and perf-audit work packages.
---

# QA for LCC+ games

You judge the game by running it, not by reading it alone. Unless the brief says
otherwise, you add tests and report findings; you don't fix game code.

## Turning acceptance criteria into tests

- One scenario per behavior, named as the behavior ("placing a path on water is refused").
- Assert **state** through memory (`expect.memory`) and **presentation** through a few
  screen rows (`screen.lines`/`contains`) or colors (`colors`/`bg`). Avoid whole-screen
  `equals` — it breaks on every art change.
- Cover: the happy path, each refusal/limit (no money, out of bounds, full pool), boundary
  values (0, max, wraparound), quitting/ending, and determinism (same keys + `clock` → same
  result; a second `clock` for RNG-independent properties).
- Add `maxStepsPerFrame` to a long-running scenario as a performance guard.
- New failing tests are a valid deliverable: they document a bug for the owning WP.

## Playtesting headlessly

Script a real session and read the frames:

```bash
node tools/lccgame.js run games/<g> --keys "_ d*5 1 <space> s*3 <space> _40 i" --show changed --watch "st_cash_k,st_cash_u" | less
```

Look for: stale characters left behind, flicker-prone full clears, wrong colors, text
overflowing its region, numbers not updating, input that does nothing, states you can get
stuck in, and anything that contradicts DESIGN.md. Long idle runs (`_500`) reveal
simulation drift, pool exhaustion and slowdowns (`--profile`).

## Code review checklist (assembly)

- Calling convention: public routines preserve every register except r0 (when they return
  a value); `lr` is pushed before any `bl` inside a routine and popped before `ret`.
- Stack balance on **every** path, including early exits and error branches.
- r5/r6/r7 never used as scratch (except a documented frame pointer setup).
- Flags: the branch right after the intended `cmp`/`add`/`sub`; no `brzp`/`brge`-style
  mnemonics; `brp` excludes zero.
- Ranges: imm5 (−16..15) for add/sub/cmp/and, imm9 for mov, offset6 for ldr/str, record
  fields ≤ 31; products of `mul` < 32768; divisors checked for zero.
- Labels carry the module prefix; `;;` contract lines match the code (registers, result).
- Only the files the WP owns were changed; no writes to state the contract doesn't name.
- Loops always terminate (counter decremented on every path) and contain a `sleep` if they
  can run for many frames.

## Performance audit

`run --profile` over a representative session (≥ 100 frames, busy game state). Report
instructions/frame by module and the top routines; flag anything over the budget in
DESIGN.md (default target ≤ 2M per frame) and suggest the specific fix (time-slicing,
lookup table, direct cell writes, caching a BFS).

## Findings report

```
WP: <id>   STATUS: done
TESTS ADDED: <files>  RESULT: <summary line; list failing scenarios>
FINDINGS (most severe first):
  1. [bug|risk|perf|style] <file>:<line> — <what is wrong>; repro: <keys / scenario>; expected <x>, got <y>
CHECK: <check summary line>
```
