#!/usr/bin/env node
'use strict';
// lccgame — build / run / test / play LCC+ (.ap) games.
// Run `node tools/lccgame.js help` for usage.

const fs = require('fs');
const path = require('path');
const { build, resolveTarget, BuildError, formatDiagnostics, rel, hex4, ROOT } = require('./lib/assemble');
const { runHeadless, parseWatch, readSymbol, toSigned, IDLE_POLLS } = require('./lib/headless');
const { parseKeys } = require('./lib/keys');
const { GLYPHS } = require('./lib/display');

const USAGE = `lccgame — LCC+ game toolchain (headless + interactive)

USAGE
  node tools/lccgame.js <command> [args]

  <target> is a game directory (with game.json), a game.json, or an .ap file.

COMMANDS
  build <target> [--map] [--listing] [--symbols] [--out path.ep]
        Assemble (.include, .define, .pstring, far-reference relaxation, game.json lint).
        Errors: file:line + hint. --map: words per file/module and memory budget.

  run <target> [options]
        Run headless & deterministically, print the screen.
          --keys "<script>"   per-frame input, e.g. "d d _3 w q"  (see below)
          --frames N          stop after N frames (default: script length + --tail)
          --tail N            extra frames after the last key batch (default 1)
          --show final|all|changed|N,M,...|none   which frames to print (default final;
                              changed = text changed, or colors too with --colors)
          --colors            also print fg/bg color maps of shown frames
          --watch "a,b:4,msg:s"  labeled memory (signed words; :N = N words; :s = string)
          --profile           instructions per routine & module (performance)
          --size RxC          virtual terminal size (default: game.json "size" or 30x100)
          --max-steps N       whole-run instruction budget (default 100000000)
          --max-frame-steps N budget between two frame boundaries (default 2000000)
          --clock N           virtual clock start in ms (affects millis-based seeds)
          --json              machine-readable result

  test [targets or dirs...]   Run scenario files (*.test.json). Default: games/, lib/, tools/tests/.
  check                       Build every game + run every test (the integration gate).
  play <target> [--term-colors]  Interactive, real terminal (for humans, not agents).
                                 Uses a built-in opaque 24-bit palette by default; --term-colors uses terminal ANSI colors.
  new <name> [--modular]      Scaffold games/<name>/ (--modular: game.json + src/ modules).
  api <target> [--lib]        Print every module's ';;' contract lines (public API) — paste
                              into subagent briefs. --lib also includes lib/ routines.
  glyphs                      Print the code-page-437 glyph table used by 'present'.

KEY SCRIPTS (one token = one frame of input)
  d        key 'd' this frame          wasd     four keys queued in one frame
  _ / _5   1 / 5 frames with no input   d*4      four frames each with 'd'
  42<enter>   for din/sin/ain programs
  named: <enter> <space> <tab> <esc> <bs> <up> <down> <left> <right> <lt> <star> <us> <hash> <65>

FRAMES
  A frame ends at every 'sleep', when nbain is polled ${IDLE_POLLS}x in a row with no key
  (busy-wait), or when a blocking read (ain/din/sin) needs input.
`;

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  const flagOnly = ['lib', 'listing', 'symbols', 'json', 'colors', 'term-colors', 'quiet', 'verbose', 'map', 'profile', 'modular', 'no-relax'];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (flagOnly.includes(key)) opt[key] = true;
      else {
        if (i + 1 >= argv.length) die(`Option --${key} needs a value`);
        opt[key] = argv[++i];
      }
    } else pos.push(a);
  }
  return { pos, opt };
}

function die(msg, code = 2) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

function buildTarget(target, opt = {}) {
  const t = resolveTarget(target);
  const b = build(t.entry, { manifest: t.manifest, gameDir: t.gameDir, relax: !opt['no-relax'] });
  b.target = t;
  return b;
}

function doBuild(target, opt) {
  if (!target) die('Missing <target> (game directory, game.json or .ap file)');
  if (!fs.existsSync(target)) die(`No such file or directory: ${target}`);
  try {
    return buildTarget(target, opt);
  } catch (e) {
    if (e instanceof BuildError) {
      process.stderr.write(formatDiagnostics(e.diagnostics) + '\n');
      process.stderr.write('BUILD FAILED\n');
      process.exit(1);
    }
    throw e;
  }
}

function outPath(b, opt) {
  if (opt.out) return opt.out;
  const t = b.target;
  const name = t.manifest ? path.basename(t.gameDir) : path.basename(path.dirname(t.entry)) + '-' + path.basename(t.entry, path.extname(t.entry));
  return path.join(ROOT, 'build', name + '.ep');
}

function printMap(b) {
  const total = b.words;
  const modules = (b.target.manifest && b.target.manifest.modules) || {};
  const owner = new Map(Object.entries(modules).map(([f, s]) => [path.resolve(b.target.gameDir, f), s]));
  console.log('words  file');
  for (const f of b.files) {
    const spec = owner.get(f);
    console.log(`${String(b.fileWords.get(f) || 0).padStart(5)}  ${rel(f)}${spec ? `  [${[].concat(spec.prefix || []).join(',') || 'no labels'}${spec.owner ? ' owner=' + spec.owner : ''}]` : ''}`);
  }
  const free = 65536 - total;
  console.log(`${String(total).padStart(5)}  total program (0x0000-${hex4(total - 1)}); ${free} words left for stack + heap (stack grows down from 0xFFFF)`);
  if (b.relaxed.length) console.log(`far references rewritten: ${b.relaxed.length} (+${b.relaxed.reduce((a, r) => a + r.extraWords, 0)} words)`);
}

function cmdBuild(pos, opt) {
  const b = doBuild(pos[0], opt);
  const out = outPath(b, opt);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, b.bytes);
  const relax = b.relaxed.length ? `, ${b.relaxed.length} far refs rewritten` : '';
  console.log(`OK  ${rel(b.target.entry)}: ${b.words} words, ${b.files.length} files, start=${hex4(b.startAddress)}${relax} -> ${rel(out)}`);
  if (b.words > 56000) console.log('WARNING: program is close to the 65536-word memory limit (stack grows down from 0xFFFF).');
  if (opt.map) printMap(b);
  if (opt.verbose && b.relaxed.length) for (const r of b.relaxed) console.log(`  far: ${rel(r.file)}:${r.line}  ${r.text}`);
  if (opt.symbols) {
    const entries = Object.entries(b.symbols).filter(([k]) => !k.startsWith('__far')).sort((x, y) => x[1] - y[1]);
    for (const [k, v] of entries) console.log(`  ${hex4(v)}  ${k}`);
    const defs = Object.entries(b.defines);
    if (defs.length) { console.log('defines:'); for (const [k, v] of defs) console.log(`  ${k} = ${v}`); }
  }
  if (opt.listing) {
    let lastFile = null;
    for (const l of b.listing) {
      if (!l.words.length && !l.text.trim()) continue;
      if (l.file !== lastFile) { console.log(`--- ${rel(l.file)}`); lastFile = l.file; }
      const words = l.words.slice(0, 3).map(w => (w & 0xFFFF).toString(16).padStart(4, '0')).join(' ') + (l.words.length > 3 ? ' ..' : '');
      console.log(`${l.words.length ? hex4(l.addr) : '      '}  ${words.padEnd(17)} ${String(l.line).padStart(4)}| ${l.text}`);
    }
  }
}

function formatScreen(text, minWidth = 10) {
  const lines = text === '' ? [] : text.split('\n');
  const width = Math.max(minWidth, ...lines.map(l => [...l].length));
  const out = [];
  out.push('   +' + '-'.repeat(width) + '+');
  lines.forEach((l, i) => out.push(String(i).padStart(3) + '|' + l + ' '.repeat(width - [...l].length) + '|'));
  out.push('   +' + '-'.repeat(width) + '+');
  return out.join('\n');
}

function srcLoc(s) { return s ? `${rel(s.file)}:${s.line}  ${s.text}` : '(no source line: PC is outside assembled code/data)'; }

function runOpts(opt, manifest) {
  const o = {};
  o.batches = parseKeys(opt.keys || '');
  if (opt.frames !== undefined) o.frames = parseInt(opt.frames, 10);
  if (opt.tail !== undefined) o.tail = parseInt(opt.tail, 10);
  if (opt['max-steps']) o.maxSteps = parseInt(opt['max-steps'], 10);
  if (opt['max-frame-steps']) o.maxFrameSteps = parseInt(opt['max-frame-steps'], 10);
  if (opt.clock) o.clockStart = parseInt(opt.clock, 10);
  const size = opt.size || (manifest && manifest.size);
  if (size) {
    const m = String(size).match(/^(\d+)x(\d+)$/);
    if (!m) die('--size must look like 30x100');
    o.rows = parseInt(m[1], 10); o.cols = parseInt(m[2], 10);
  }
  if (opt.watch) o.watch = parseWatch(opt.watch);
  if (opt.profile) o.profile = true;
  return o;
}

function profileReport(b, r) {
  // attribute each address to the nearest preceding label (routine) and file (module)
  // listing rows carry only some labels; the symbol table has them all
  const labels = Object.entries(b.symbols).filter(([l]) => !l.startsWith('__far')).map(([label, addr]) => ({ addr, label }));
  labels.sort((x, y) => x.addr - y.addr);
  const byLabel = new Map();
  const byFile = new Map();
  let li = -1;
  let total = 0;
  for (let a = 0; a < 65536; a++) {
    const n = r.hotCounts[a];
    while (li + 1 < labels.length && labels[li + 1].addr <= a) li++;
    if (!n) continue;
    total += n;
    const lab = li >= 0 ? labels[li].label : '(start)';
    byLabel.set(lab, (byLabel.get(lab) || 0) + n);
    const src = b.sourceMap.get(a);
    const f = src ? rel(src.file) : '(unknown)';
    byFile.set(f, (byFile.get(f) || 0) + n);
  }
  const frames = Math.max(1, r.frames.length);
  console.log(`profile: ${total} instructions over ${frames} frames (${Math.round(total / frames)}/frame; ~${Math.round(100000000 / Math.max(1, total / frames))} fps max at 100M instr/s, ~${Math.round(5000000 / Math.max(1, total / frames))} fps on the upstream interpreter)`);
  console.log('  by module:');
  for (const [f, n] of [...byFile].sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`  ${String(Math.round(n / frames)).padStart(9)}/frame ${(100 * n / total).toFixed(1).padStart(5)}%  ${f}`);
  console.log('  by routine (nearest label):');
  for (const [l, n] of [...byLabel].sort((x, y) => y[1] - x[1]).slice(0, 20)) console.log(`  ${String(Math.round(n / frames)).padStart(9)}/frame ${(100 * n / total).toFixed(1).padStart(5)}%  ${l}`);
}

function printResult(r, opt) {
  const show = opt.show || 'final';
  let frames = [];
  if (show === 'all') frames = r.frames;
  else if (show === 'changed') frames = r.frames.filter(f => f.changed || (opt.colors && f.colorChanged));
  else if (/^[\d,]+$/.test(show)) {
    const want = new Set(show.split(',').map(Number));
    frames = r.frames.filter(f => want.has(f.frame));
  }
  const shown = frames.map(f => f.text).concat(show === 'final' ? [r.screen] : []);
  const W = Math.max(10, ...shown.flatMap(t => t.split('\n').map(l => [...l].length)));
  const colorMaps = (fg, bg) => { console.log('    fg:'); console.log(formatScreen(fg, W)); console.log('    bg:'); console.log(formatScreen(bg, W)); };
  for (const f of frames) {
    const w = Object.keys(f.watch).length ? '  ' + Object.entries(f.watch).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ') : '';
    console.log(`=== frame ${f.frame} (${f.reason}, t=${f.timeMs}ms, step ${f.step})${w}`);
    console.log(formatScreen(f.text, W));
    if (opt.colors) colorMaps(f.colors, f.bg);
  }
  if (show === 'final') {
    console.log(`=== final screen (frame ${r.frame})`);
    console.log(formatScreen(r.screen, W));
    if (opt.colors) colorMaps(r.colors, r.bg);
  }
  console.log(`status: ${r.status}${r.detail ? ' — ' + r.detail : ''}`);
  console.log(`steps: ${r.steps}  frames: ${r.frames.length}  presents: ${r.presents}  virtual time: ${r.timeMs}ms  cursor: ${r.cursorVisible ? 'visible' : 'hidden'}  (screens trimmed to content; terminal ${r.size})`);
  if (r.events.length) {
    const ev = r.events.slice(0, 20).map(e => `f${e.frame}:${e.type}(${e.detail})`).join(' ');
    console.log(`events: ${ev}${r.events.length > 20 ? ` ... (+${r.events.length - 20})` : ''}`);
  }
  if (Object.keys(r.watch).length) {
    console.log('watch:');
    for (const [k, v] of Object.entries(r.watch)) console.log(`  ${k} = ${JSON.stringify(v)}`);
  }
  if (r.unconsumedKeys) console.log(`unconsumed input: ${JSON.stringify(r.unconsumedKeys)}`);
  if (r.status === 'runtime-error' || r.status === 'step-limit') {
    console.log(`pc: ${hex4(r.pc)}  ${srcLoc(r.pcSource)}`);
    console.log(`registers: ${r.registers.map((v, i) => `r${i}=${toSigned(v)}`).join(' ')}`);
    if (r.hotspots) {
      console.log('hottest instructions:');
      for (const h of r.hotspots) console.log(`  ${String(h.count).padStart(9)}x ${hex4(h.addr)}  ${srcLoc(h.src)}`);
    }
  }
  if (r.stderr.length) console.log('interpreter stderr:\n  ' + r.stderr.join('\n  '));
}

function cmdRun(pos, opt) {
  const b = doBuild(pos[0], opt);
  const r = runHeadless(b, runOpts(opt, b.target.manifest));
  if (opt.json) {
    const { mem, hotCounts, ...rest } = r;
    console.log(JSON.stringify(rest, null, 1));
  } else {
    printResult(r, opt);
    if (opt.profile) profileReport(b, r);
  }
  process.exit(r.status === 'runtime-error' || r.status === 'step-limit' ? 1 : 0);
}

// ---------------------------------------------------------------- tests

function findTests(paths) {
  const out = [];
  const walk = p => {
    if (!fs.existsSync(p)) die(`No such path: ${p}`);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p).sort()) {
        if (e === 'node_modules' || e === 'build' || e.startsWith('.')) continue;
        walk(path.join(p, e));
      }
    } else if (p.endsWith('.test.json')) out.push(p);
  };
  (paths.length ? paths : [path.join(ROOT, 'games'), path.join(ROOT, 'lib'), path.join(ROOT, 'tools', 'tests')]).forEach(walk);
  return out;
}

function checkScreen(label, text, exp, fails) {
  if (!exp) return;
  for (const s of [].concat(exp.contains || [])) if (!text.includes(s)) fails.push(`${label}: expected to contain ${JSON.stringify(s)}`);
  for (const s of [].concat(exp.notContains || [])) if (text.includes(s)) fails.push(`${label}: expected NOT to contain ${JSON.stringify(s)}`);
  for (const s of [].concat(exp.matches || [])) if (!new RegExp(s, 'm').test(text)) fails.push(`${label}: expected to match /${s}/m`);
  if (exp.equals !== undefined) {
    const want = [].concat(exp.equals).join('\n').replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
    if (text !== want) fails.push(`${label}: screen differs from expected text`);
  }
  if (exp.lines) {
    const lines = text.split('\n');
    for (const [k, v] of Object.entries(exp.lines)) {
      const got = (lines[Number(k)] || '');
      if (got !== v.replace(/\s+$/, '')) fails.push(`${label}: line ${k} is ${JSON.stringify(got)}, expected ${JSON.stringify(v)}`);
    }
  }
}

function checkMemory(label, symbols, mem, exp, fails) {
  if (!exp) return;
  for (const [name, want] of Object.entries(exp)) {
    let spec;
    if (typeof want === 'string') spec = { name, count: 's' };
    else if (Array.isArray(want)) spec = { name, count: want.length };
    else spec = { name, count: 1 };
    const got = readSymbol(mem, symbols, spec);
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${label}: memory ${name} = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
  }
}

// Which program does a test file exercise?  spec.game (relative to the test
// file) or else the game directory above tests/ (game.json or main.ap).
function testTarget(tf, spec) {
  if (spec.game) return path.resolve(path.dirname(tf), spec.game);
  const gameDir = path.resolve(path.dirname(tf), '..');
  if (fs.existsSync(path.join(gameDir, 'game.json'))) return gameDir;
  return path.join(gameDir, 'main.ap');
}

function runTests(files, opt) {
  let pass = 0; let fail = 0;
  const builds = new Map();
  for (const tf of files) {
    let spec;
    try { spec = JSON.parse(fs.readFileSync(tf, 'utf8')); } catch (e) { console.log(`FAIL ${rel(tf)}: invalid JSON: ${e.message}`); fail++; continue; }
    const target = testTarget(tf, spec);
    let b = builds.get(target);
    if (!b) {
      try { b = buildTarget(target); } catch (e) {
        const msg = e instanceof BuildError ? formatDiagnostics(e.diagnostics) : e.stack;
        console.log(`FAIL ${rel(tf)}: build of ${rel(target)} failed\n${msg}`);
        fail += (spec.scenarios || []).length || 1;
        continue;
      }
      builds.set(target, b);
    }
    const manifest = b.target.manifest;
    for (const sc of spec.scenarios || []) {
      const name = `${rel(tf)} › ${sc.name || '(unnamed)'}`;
      const fails = [];
      let r;
      const t0 = Date.now();
      try {
        r = runHeadless(b, runOpts({ keys: sc.keys, frames: sc.frames, tail: sc.tail, 'max-steps': sc.maxSteps, 'max-frame-steps': sc.maxFrameSteps, clock: sc.clock, size: sc.size || spec.size, watch: sc.watch }, manifest));
      } catch (e) {
        fails.push(`harness error: ${e.message}`);
      }
      if (r) {
        const exp = sc.expect || {};
        const okStatuses = [].concat(exp.status || ['halted', 'frames-complete', 'waiting-for-input']);
        if (!okStatuses.includes(r.status)) fails.push(`status is ${r.status}${r.detail ? ' (' + r.detail + ')' : ''}, expected ${okStatuses.join(' or ')}${r.pcSource ? ` [pc at ${srcLoc(r.pcSource)}]` : ''}`);
        checkScreen('final screen', r.screen, exp.screen, fails);
        checkMemory('final', b.symbols, r.mem, exp.memory, fails);
        for (const fe of exp.frames || []) {
          const f = r.frames.find(x => x.frame === fe.frame);
          if (!f) { fails.push(`frame ${fe.frame} was never reached (ran ${r.frames.length} frames)`); continue; }
          checkScreen(`frame ${fe.frame}`, f.text, fe.screen, fails);
          if (fe.colors) checkScreen(`frame ${fe.frame} fg colors`, f.colors, fe.colors, fails);
        }
        if (exp.colors) checkScreen('final fg colors', r.colors, exp.colors, fails);
        if (exp.bg) checkScreen('final bg colors', r.bg, exp.bg, fails);
        if (exp.sounds) {
          const got = r.events.filter(e => e.type === 'sound').map(e => e.detail);
          for (const s of [].concat(exp.sounds)) if (!got.includes(s)) fails.push(`expected sound ${s}, got [${got.join(', ')}]`);
        }
        if (exp.maxSteps && r.steps > exp.maxSteps) fails.push(`used ${r.steps} steps, budget ${exp.maxSteps}`);
        if (exp.maxStepsPerFrame) {
          let worst = 0; let prev = 0;
          for (const f of r.frames) { worst = Math.max(worst, f.step - prev); prev = f.step; }
          if (worst > exp.maxStepsPerFrame) fails.push(`slowest frame used ${worst} instructions, budget ${exp.maxStepsPerFrame}`);
        }
      }
      if (fails.length) {
        fail++;
        console.log(`FAIL ${name}`);
        for (const f of fails) console.log(`     - ${f}`);
        if (r) console.log(formatScreen(r.screen).split('\n').map(l => '     ' + l).join('\n'));
      } else {
        pass++;
        if (!opt.quiet) console.log(`ok   ${name}${Date.now() - t0 > 2000 ? ` (${((Date.now() - t0) / 1000).toFixed(1)}s)` : ''}`);
      }
    }
  }
  return { pass, fail };
}

function cmdTest(pos, opt) {
  const files = findTests(pos);
  if (!files.length) { console.log('No *.test.json files found.'); return; }
  const { pass, fail } = runTests(files, opt);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

function listGames() {
  const dir = path.join(ROOT, 'games');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map(e => path.join(dir, e)).filter(d => fs.statSync(d).isDirectory())
    .map(d => (fs.existsSync(path.join(d, 'game.json')) ? d : path.join(d, 'main.ap'))).filter(p => fs.existsSync(p));
}

function cmdCheck(pos, opt) {
  let bad = 0;
  console.log('== build');
  for (const g of listGames()) {
    try {
      const b = buildTarget(g);
      console.log(`ok   ${rel(g)} (${b.words} words${b.relaxed.length ? `, ${b.relaxed.length} far refs` : ''})`);
    } catch (e) {
      bad++;
      console.log(`FAIL ${rel(g)}\n${e instanceof BuildError ? formatDiagnostics(e.diagnostics) : e.stack}`);
    }
  }
  console.log('== test');
  const { pass, fail } = runTests(findTests([]), { quiet: true });
  console.log(`\n${bad ? `${bad} game(s) failed to build; ` : ''}${pass} passed, ${fail} failed`);
  process.exit(bad || fail ? 1 : 0);
}

// ---------------------------------------------------------------- play / new / glyphs

function cmdPlay(pos, opt) {
  const b = doBuild(pos[0], opt);
  const out = outPath(b, opt);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, b.bytes);
  if (!process.stdin.isTTY) die('play needs an interactive terminal. Agents: use `run` with --keys instead.');
  require('./lib/player').play(out, opt['term-colors'] ? { colorMode: 'ansi' } : {});
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src)) {
    const s = path.join(src, e); const d = path.join(dst, e);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

function cmdNew(pos, opt) {
  const name = pos[0];
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) die('Usage: new <name> [--modular]   (lowercase letters, digits, dashes)');
  const dir = path.join(ROOT, 'games', name);
  if (fs.existsSync(dir)) die(`${rel(dir)} already exists`);
  copyDir(path.join(ROOT, 'templates', opt.modular ? 'modular' : 'simple'), dir);
  const gj = path.join(dir, 'game.json');
  if (fs.existsSync(gj)) fs.writeFileSync(gj, fs.readFileSync(gj, 'utf8').replace(/__NAME__/g, name));
  console.log(`Created ${rel(dir)}/`);
  console.log(`Try: node tools/lccgame.js run ${rel(dir)}${opt.modular ? '' : '/main.ap'} --keys "d d s q" --show changed`);
}

function cmdApi(pos, opt) {
  if (!pos[0]) die('Usage: api <target> [--lib]');
  const t = resolveTarget(pos[0]);
  const { preprocess, LIB_DIR } = require('./lib/assemble');
  let pre;
  try { pre = preprocess(t.entry); } catch (e) { if (e instanceof BuildError) die(formatDiagnostics(e.diagnostics), 1); throw e; }
  const modules = (t.manifest && t.manifest.modules) || {};
  const specFor = f => Object.entries(modules).find(([m]) => path.resolve(t.gameDir, m) === f);
  for (const f of pre.files) {
    const isLib = f.startsWith(LIB_DIR + path.sep);
    if (isLib && !opt.lib) continue;
    const text = fs.readFileSync(f, 'utf8').split('\n');
    const api = text.filter(l => /^\s*;;/.test(l)).map(l => l.replace(/^\s*;;\s?/, ''));
    const defs = isLib ? [] : text.filter(l => /^\s*\.define\s/i.test(l)).length;
    const spec = specFor(f);
    const head = spec ? `  (prefix ${[].concat(spec[1].prefix || []).join(',') || 'none'}; owner ${spec[1].owner || '-'})` : '';
    if (!api.length && !defs) continue;
    console.log(`== ${rel(f)}${head}`);
    for (const l of api) console.log(`  ${l}`);
    if (defs) console.log(`  (${defs} .define constants — see file)`);
  }
}

function cmdGlyphs() {
  console.log('Glyph codes for `present` cells (low byte). 0 renders as space.');
  for (let row = 0; row < 16; row++) {
    let line = '';
    for (let col = 0; col < 16; col++) {
      const c = row * 16 + col;
      line += `${String(c).padStart(3)} ${GLYPHS[c]}  `;
    }
    console.log(line);
  }
  console.log('\nUseful: 176-178 ░▒▓  219 █  220 ▄  223 ▀  221 ▌ 222 ▐  254 ■  250 ·  249 ∙  4 ♦  3 ♥  15 ☼  30-31 ▲▼  16-17 ►◄  24-27 ↑↓→←');
  console.log('Box (single) 218┌ 191┐ 192└ 217┘ 196─ 179│ 195├ 180┤ 194┬ 193┴ 197┼');
  console.log('Box (double) 201╔ 187╗ 200╚ 188╝ 205═ 186║ 204╠ 185╣ 203╦ 202╩ 206╬');
  console.log('Colors (attr nibbles): 0 black 1 red 2 green 3 yellow 4 blue 5 magenta 6 cyan 7 white, +8 bright.  cell = glyph | fg<<8 | bg<<12');
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parseArgs(rest);
  switch (cmd) {
    case 'build': return cmdBuild(pos, opt);
    case 'run': return cmdRun(pos, opt);
    case 'test': return cmdTest(pos, opt);
    case 'check': return cmdCheck(pos, opt);
    case 'play': return cmdPlay(pos, opt);
    case 'new': return cmdNew(pos, opt);
    case 'glyphs': return cmdGlyphs();
    case 'api': return cmdApi(pos, opt);
    case undefined: case 'help': case '-h': case '--help': console.log(USAGE); return;
    default: die(`Unknown command: ${cmd}\n\n${USAGE}`);
  }
}

main();
