# <Game title> — work plan

Owner: orchestrator. Update after every dispatch and hand-back.
Status: `todo | active | review | done | blocked`. A WP may start when its dependencies are
`done`, its files don't overlap an `active` WP, and every routine it calls exists (stub ok).

| WP | Title | Owns (files) | Depends | Skills | Status |
|----|-------|--------------|---------|--------|--------|
| WP0 | Walking skeleton | game.json, main.ap, src/defs.ap, src/state.ap, module stubs | — | lcc-architect | todo |

---

## WP0 — Walking skeleton
**Goal:** the game builds, runs and quits; every module exists as a stub with its `;;` contract.
**Acceptance:**
- `node tools/lccgame.js check` passes
- `tests/smoke.test.json`: first frame renders, `q` halts
**Log:**
- (date) dispatched / result / notes
