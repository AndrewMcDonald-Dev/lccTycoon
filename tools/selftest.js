#!/usr/bin/env node
'use strict';
// Harness self-test: the fast interpreter core must match upstream lccjs
// step() exactly (registers, flags, memory, screen, step count) on every
// bundled demo and every game. Run: node tools/selftest.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const { build, ROOT, VENDOR } = require('./lib/assemble');
const { runHeadless } = require('./lib/headless');
const { parseKeys } = require('./lib/keys');
const display = require('./lib/display');

// Interactive terminal display checks: built-in opaque palette, canvas fill, SGR translator.
(function testInteractiveDisplay() {
  const mem = new Uint16Array(64);
  // 3x1 block at (0,0): [attr=0 space, FG_GREEN 'A', FG_BLACK|BG_BYELLOW '@']
  mem[0] = 3; mem[1] = 1; mem[2] = 0; mem[3] = 0;
  mem[4] = 32;                     // attr=0 (must still get explicit opaque RGB bg, never bare \x1b[0m)
  mem[5] = 65 | 0x0200;            // FG_GREEN on BG_BLACK
  mem[6] = 64 | 0xB000;            // FG_BLACK on BG_BYELLOW
  const prev = new Map();
  const out = display.presentToAnsi(mem, 0, prev, { colorMode: 'truecolor' });
  assert(!out.includes('\x1b[0m'), 'presentToAnsi must not emit bare SGR reset (see-through default bg)');
  assert(out.includes('48;2;17;19;26m'), 'attr=0 and BG_BLACK must use explicit opaque canvas RGB');
  assert(out.includes('38;2;68;179;96;48;2;17;19;26mA'), 'FG_GREEN cell uses built-in RGB palette');
  assert(out.includes('38;2;17;19;26;48;2;245;204;66m@'), 'cursor cell uses dark ink on bright yellow RGB');
  assert.strictEqual(display.presentToAnsi(mem, 0, prev, { colorMode: 'truecolor' }), '', 'unchanged frame diffs to empty');

  // 256-color fallback uses fixed 16..255 indices (never terminal 0..15 theme colors).
  const out256 = display.presentToAnsi(mem, 0, new Map(), { colorMode: '256' });
  assert(out256.includes('48;5;233m'), '256-color mode uses fixed opaque background index 233');

  // Canvas fill covers every row with explicit opaque background and disables/restores autowrap.
  const canvas = display.fillCanvasAnsi(3, 5, 'truecolor');
  assert(canvas.includes('\x1b[?7l') && canvas.includes('\x1b[?7h'), 'canvas fill guards autowrap');
  assert(canvas.includes('\x1b[3;1H     '), 'canvas fill paints bottom row with spaces');

  // Stream translator handles split escape sequences (term_color/term_reset in lemonade) without see-through resets.
  const tr = display.createAnsiTranslator('truecolor');
  const translated = tr.translate('\x1b[') + tr.translate('33') + tr.translate('mHI') + tr.translate('\x1b[0m!');
  assert(!translated.includes('\x1b[0m'), 'SGR 0 reset translates to opaque default style');
  assert(translated.includes('38;2;217;168;62;48;2;17;19;26mHI'), 'SGR 33 translates to built-in yellow on opaque canvas');
  assert(translated.includes('38;2;202;208;220;48;2;17;19;26m!'), 'SGR 0 restores built-in white on opaque canvas');

  // Color mode detection.
  assert.strictEqual(display.detectColorMode({ TERM: 'xterm-256color' }), 'truecolor');
  assert.strictEqual(display.detectColorMode({ TERM_PROGRAM: 'Apple_Terminal' }), '256');
  assert.strictEqual(display.detectColorMode({ TERM_PROGRAM: 'Apple_Terminal', COLORTERM: 'truecolor' }), 'truecolor');
  assert.strictEqual(display.detectColorMode({ TERM: 'linux' }), 'ansi');
  assert.strictEqual(display.detectColorMode({ LCC_COLOR_MODE: 'ansi', COLORTERM: 'truecolor' }), 'ansi');
})();

// Far-reference relaxation must stop and report genuine errors (fixtures in tools/tests/build_errors).
(function testRelaxationErrors() {
  const dir = path.join(ROOT, 'tools', 'tests', 'build_errors');
  const fail = f => {
    try { build(path.join(dir, f), {}); } catch (e) { return { diags: e.diagnostics || [] }; }
    assert.fail(`${f} should not build`);
  };
  // straddle.ap used to loop forever: build it in a child process with a timeout.
  const cp = require('child_process').spawnSync(process.execPath,
    [path.join(ROOT, 'tools', 'lccgame.js'), 'build', path.join(dir, 'straddle.ap'), '--out', path.join(require('os').tmpdir(), 'lcc-straddle.ep')],
    { encoding: 'utf8', timeout: 20000 });
  assert(!cp.error, `straddle.ap build must terminate (${cp.error && cp.error.code})`);
  assert(cp.status !== 0 && /straddle\.ap:7: error: Program too big\n\s+brlt main\n/.test(cp.stderr),
    `straddle.ap reports Program too big on the author's line, got:\n${cp.stderr}`);
  const bl = fail('bad_label.ap');
  assert.deepStrictEqual(bl.diags.map(d => [d.line, d.message]), [[5, 'Invalid operation'], [6, 'Bad label']], 'bad_label.ap keeps both errors');
  const ty = fail('typo.ap');
  assert.deepStrictEqual(ty.diags.map(d => [d.line, d.message, d.source.trim()]), [[6, 'Undefined label', 'ld r0, no_such_var']], 'typo.ap reports its own source line');
  console.log('ok   far relaxation stops and reports genuine errors');
})();

// run --show changed --colors must include frames whose only change is a color.
(function testColorOnlyChange() {
  const cp = require('child_process');
  const run = (...a) => cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'lccgame.js'), 'run',
    path.join(ROOT, 'tools', 'tests', 'color_only.ap'), '--frames', '3', '--show', 'changed', ...a], { encoding: 'utf8' }).stdout;
  const shown = out => (out.match(/^=== frame (\d+)/gm) || []).map(l => +l.split(' ')[2]);
  assert.deepStrictEqual(shown(run('--colors')), [0, 1], 'changed + --colors lists the color-only frame');
  assert.deepStrictEqual(shown(run()), [0], 'plain changed still lists text changes only');
  console.log('ok   run --show changed --colors includes color-only frames');
})();

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
