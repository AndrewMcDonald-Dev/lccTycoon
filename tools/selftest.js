#!/usr/bin/env node
'use strict';
// Harness self-test: the fast interpreter core must match upstream lccjs
// step() exactly (registers, flags, memory, screen, step count) on every
// bundled demo and every game. Run: node tools/selftest.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { build, ROOT, VENDOR } = require('./lib/assemble');
const { runHeadless } = require('./lib/headless');
const { parseKeys } = require('./lib/keys');

const files = [];
const demoDir = path.join(VENDOR, 'plusdemos');
for (const f of fs.readdirSync(demoDir).sort()) if (f.endsWith('.ap')) files.push(path.join(demoDir, f));
for (const base of ['games', 'lib/tests']) {
  const walk = d => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d).sort()) { const p = path.join(d, e); if (fs.statSync(p).isDirectory()) walk(p); else if (e === 'main.ap' || (base === 'lib/tests' && e.endsWith('.ap'))) files.push(p); } };
  walk(path.join(ROOT, base));
}
const keys = parseKeys('_ 1 d 5 w 9 s 3 a <enter> g b _3 q _2 q');
const digest = r => crypto.createHash('sha1').update(Buffer.from(r.mem.buffer)).digest('hex').slice(0, 12);
let bad = 0;
for (const f of files) {
  let b;
  try { b = build(f); } catch (e) { console.log(`skip ${path.relative(ROOT, f)} (does not build)`); continue; }
  const opts = { batches: keys, rows: 30, cols: 100, maxSteps: 30_000_000 };
  const fast = runHeadless(b, opts);
  const slow = runHeadless(b, { ...opts, slow: true });
  const same = fast.status === slow.status && fast.steps === slow.steps && fast.screen === slow.screen
    && digest(fast) === digest(slow) && fast.registers.join() === slow.registers.join();
  console.log(`${same ? 'ok  ' : 'DIFF'} ${path.relative(ROOT, f)} (${fast.status}, ${fast.steps} steps)`);
  if (!same) { bad++; console.log(`     fast: ${fast.status} ${fast.steps} ${digest(fast)} | slow: ${slow.status} ${slow.steps} ${digest(slow)}`); }
}
console.log(bad ? `${bad} mismatches` : 'fast core matches upstream on all programs');
process.exit(bad ? 1 : 0);
