'use strict';
// Build pipeline for LCC+ games:
//   1. preprocess: `.include "file"` (once per file) and `.define NAME expr`
//      constants with integer expressions in operands
//   2. assemble in memory with the upstream AssemblerPlus (+ project extensions),
//      collecting every error with file:line and a fix hint
//   3. relax: references whose target is out of PC-relative reach (bl, br*, ld,
//      lea, st) are rewritten into far forms automatically and re-assembled
//   4. lint: module label prefixes from game.json

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const VENDOR = path.join(ROOT, 'vendor', 'lccjs');
const LIB_DIR = path.join(ROOT, 'lib');
const AssemblerPlus = require(path.join(VENDOR, 'src', 'plus', 'assemblerplus.js'));
const display = require('./display');
const far = require('./farops');
const { evalExpr, ExprError } = require('./expr');

const INCLUDE_RE = /^\s*\.include\s+"([^"]+)"\s*(;.*)?$/i;
const DEFINE_RE = /^\s*\.define\s+(\S+)\s+(.+?)\s*$/i;
const PSTRING_RE = /^(\s*)([A-Za-z_$@][\w$@]*:)?(\s*)\.pstring(?:\s+(.*))?$/i;
const DEFINE_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED = new Set(['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'FP', 'SP', 'LR']);

// Parse `.pstring "..."` into packed 16-bit big-endian words ((c0 << 8) | c1),
// NUL-terminated (odd length: last word is (last << 8) | 0; even length: trailing 0x0000).
function parsePstringLiteral(raw) {
  const s = (raw || '').trim();
  if (s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') {
    throw new Error('.pstring expects a double-quoted string literal, e.g. .pstring "text"');
  }
  const codes = [];
  let i = 1;
  const end = s.length - 1;
  while (i < end) {
    const ch = s[i++];
    if (ch === '"') {
      throw new Error('.pstring has unexpected quote or trailing text after string literal');
    }
    if (ch === '\\') {
      if (i >= end) throw new Error('.pstring has unterminated escape sequence');
      const esc = s[i++];
      const escMap = { n: 10, r: 13, t: 9, '\\': 92, '"': 34, "'": 39, '0': 0 };
      if (!(esc in escMap)) throw new Error(`.pstring unknown escape \\${esc}`);
      codes.push(escMap[esc]);
    } else {
      const code = ch.charCodeAt(0);
      if (code > 255) throw new Error(`.pstring character out of 8-bit range: ${ch}`);
      codes.push(code);
    }
  }
  codes.push(0);
  if (codes.length % 2 === 1) codes.push(0);
  const words = [];
  for (let j = 0; j < codes.length; j += 2) {
    words.push((codes[j] << 8) | codes[j + 1]);
  }
  return words;
}

class BuildError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.diagnostics = diagnostics || [];
  }
}

function rel(p) {
  const r = path.relative(process.cwd(), p);
  return r.startsWith('..') ? p : r;
}

// ------------------------------------------------------------ preprocessing

// Split a source line into [code, comment] at the first ';' outside quotes.
function splitComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") {
      // a ' that is a char literal: 'x' or '\n'
      q = ch;
    } else if (ch === ';') {
      return [line.slice(0, i), line.slice(i)];
    }
  }
  return [line, ''];
}

// Split operands on commas outside quotes.
function splitOperands(s) {
  const out = [];
  let q = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === '\\' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") { q = ch; cur += ch; }
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const LINE_RE = /^(\s*(?:[A-Za-z_$@][\w$@]*:)?\s*)(\.?[A-Za-z_][\w]*)?(\s*)(.*)$/;
const STRING_DIRECTIVES = new Set(['.string', '.stringz', '.asciz']);

// Substitute defines and fold constant expressions in one line's operands.
function expandLine(line, defines) {
  const [code, comment] = splitComment(line);
  const m = code.match(LINE_RE);
  if (!m || !m[2] || !m[4].trim()) return line;
  const [, head, mnemonic, gap, operandText] = m;
  if (STRING_DIRECTIVES.has(mnemonic.toLowerCase())) return line;
  let changed = false;
  const ops = splitOperands(operandText).map(op => {
    const trimmed = op.trim();
    if (!trimmed) return op;
    const hasDefine = /[A-Z_][A-Z0-9_]*/.test(trimmed) && trimmed.match(/[A-Za-z_][\w]*/g).some(id => defines.has(id));
    const hasOperator = /[+\-*/%&|^~<>()]/.test(trimmed.replace(/^-(?=\d)/, '').replace(/'(\\.|[^'])'/g, '0'));
    if (!hasDefine && !hasOperator) return op;
    // Only fold operands made of numbers, char literals, defines and operators.
    const ids = trimmed.replace(/'(\\.|[^'])'/g, ' ').replace(/0x[0-9a-fA-F]+/g, ' ').match(/[A-Za-z_][\w]*/g) || [];
    if (ids.some(id => !defines.has(id))) {
      if (hasDefine) {
        const bad = ids.filter(id => !defines.has(id) && /^[A-Z_][A-Z0-9_]*$/.test(id));
        if (bad.length) throw new ExprError(`unknown constant ${bad.join(', ')} (no .define)`);
      }
      return op; // label arithmetic like table+3 — leave to the assembler
    }
    const v = evalExpr(trimmed, defines);
    changed = true;
    const lead = op.match(/^\s*/)[0];
    return lead + String(v);
  });
  if (!changed) return line;
  return head + mnemonic + gap + ops.join(',') + (comment ? ' ' + comment : '');
}

// Operand-count lint for mistakes the upstream assembler accepts silently
// (it drops extra operands/tokens, e.g. `xor r0, r1, 1` == `xor r0, r1`).
const MAX_OPERANDS = {
  mul: 2, div: 2, rem: 2, or: 2, xor: 2, mvr: 2, sext: 2, not: 2, cmp: 2, mov: 2, mvi: 2,
  srl: 2, sra: 2, sll: 2, rol: 2, ror: 2, ld: 2, st: 2, lea: 2, rand: 2, cea: 2,
  push: 1, pop: 1, bl: 1, call: 1, jsr: 1, ret: 1,
  add: 3, sub: 3, and: 3, ldr: 3, str: 3, blr: 2, jsrr: 2, jmp: 2,
  halt: 0, nl: 0, clear: 0, resetc: 0, farcall: 0, farjump: 0,
  dout: 1, udout: 1, hout: 1, aout: 1, sout: 1, din: 1, hin: 1, ain: 1, sin: 1,
  sleep: 1, nbain: 1, cursor: 1, srand: 1, millis: 1, present: 1, sound: 1,
};
for (const b of ['br', 'bral', 'brz', 'bre', 'brnz', 'brne', 'brn', 'brp', 'brlt', 'brgt', 'brc', 'brb']) MAX_OPERANDS[b] = 1;

function lintLine(line) {
  const [code] = splitComment(line);
  const m = code.match(LINE_RE);
  if (!m || !m[2] || m[2].startsWith('.')) return null;
  const mn = m[2].toLowerCase();
  if (!(mn in MAX_OPERANDS)) return null;
  const text = m[4].trim();
  if (!text) return null;
  const ops = splitOperands(text).map(o => o.trim());
  if (ops.length > MAX_OPERANDS[mn]) {
    const extra = ops.slice(MAX_OPERANDS[mn]).join(', ');
    const hint = ['mul', 'div', 'rem', 'or', 'xor'].includes(mn)
      ? ` — ${mn} is 'dr = dr ${({ mul: '*', div: '/', rem: '%', or: '|', xor: '^' })[mn]} sr' with registers only; put the constant in a register first`
      : '';
    return `${mn} takes at most ${MAX_OPERANDS[mn]} operand(s); the assembler would silently ignore "${extra}"${hint}`;
  }
  // Upstream encodes cmp's register operand as `sr2 & 3`, so `cmp rX, r4..r7`
  // silently compares against r0..r3. Swap the operands (and the branch sense) instead.
  if (mn === 'cmp' && ops.length === 2 && /^(r[4-7]|fp|sp|lr)$/i.test(ops[1])) {
    return `cmp's second register must be r0..r3 (the assembler encodes only 2 bits, so "${ops[1]}" would silently become r${(({ fp: 5, sp: 6, lr: 7 })[ops[1].toLowerCase()] ?? +ops[1].slice(1)) & 3}); swap the operands and the branch condition, or copy it into r0..r3`;
  }
  const spaced = ops.find(o => /^[^'"]*\s+[A-Za-z_]/.test(o) && !/^'/.test(o));
  if (spaced) return `unexpected token after operand "${spaced}" — one instruction per line (the assembler would silently drop the rest)`;
  return null;
}

// Expand includes and defines. Returns { lines, map, defines, files }
// map[i] = { file, line } for flattened line i.
function preprocess(entryFile) {
  const lines = [];
  const map = [];
  const seen = new Set();
  const files = [];
  const diagnostics = [];
  const defines = new Map();
  const defineSites = new Map();

  function visit(file, fromFile, fromLine) {
    const abs = path.resolve(file);
    if (seen.has(abs)) return;
    seen.add(abs);
    files.push(abs);
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (e) {
      diagnostics.push({ file: fromFile || abs, line: fromLine || 0, message: `Cannot read file ${file}` });
      return;
    }
    const src = text.replace(/\r\n/g, '\n').split('\n');
    if (src.length && src[src.length - 1] === '') src.pop();
    src.forEach((raw, i) => {
      const loc = { file: abs, line: i + 1 };
      const inc = raw.match(INCLUDE_RE);
      if (inc) {
        const relName = inc[1];
        const candidates = [path.resolve(path.dirname(abs), relName), path.resolve(LIB_DIR, relName)];
        const found = candidates.find(c => fs.existsSync(c));
        if (!found) {
          diagnostics.push({ ...loc, message: `.include: file not found: ${relName} (looked in ${candidates.map(rel).join(', ')})` });
          return;
        }
        lines.push(`; ---- begin include ${relName}`); map.push(loc);
        visit(found, abs, i + 1);
        lines.push(`; ---- end include ${relName}`); map.push(loc);
        return;
      }
      const def = splitComment(raw)[0].match(DEFINE_RE);
      if (def) {
        const [, name, expr] = def;
        if (!DEFINE_NAME_RE.test(name) || RESERVED.has(name)) {
          diagnostics.push({ ...loc, message: `.define name must be UPPER_CASE (A-Z, 0-9, _) and not a register: ${name}` });
        } else if (defines.has(name)) {
          const prev = defineSites.get(name);
          diagnostics.push({ ...loc, message: `.define ${name} already defined at ${rel(prev.file)}:${prev.line}` });
        } else {
          try {
            defines.set(name, evalExpr(expr, defines));
            defineSites.set(name, loc);
          } catch (e) {
            diagnostics.push({ ...loc, message: `.define ${name}: ${e.message}` });
          }
        }
        lines.push(`; .define ${name} = ${defines.get(name)}`); map.push(loc);
        return;
      }
      const pstr = splitComment(raw)[0].match(PSTRING_RE);
      if (pstr) {
        const [, lead, label, , arg] = pstr;
        try {
          const words = parsePstringLiteral(arg);
          words.forEach((w, wi) => {
            const prefix = wi === 0 ? (label ? `${lead}${label} ` : (lead || '        ')) : '        ';
            lines.push(`${prefix}.word ${hex4(w)}`);
            map.push(loc);
          });
        } catch (e) {
          diagnostics.push({ ...loc, message: e.message, source: raw });
        }
        return;
      }
      let out = raw;
      try {
        out = expandLine(raw, defines);
      } catch (e) {
        if (!(e instanceof ExprError)) throw e;
        diagnostics.push({ ...loc, message: e.message, source: raw });
      }
      const lintMsg = lintLine(out);
      if (lintMsg) diagnostics.push({ ...loc, message: lintMsg, source: raw });
      lines.push(out); map.push(loc);
    });
  }

  visit(entryFile);
  if (diagnostics.length) throw new BuildError('Preprocessing failed', diagnostics);
  return { lines, map, defines, defineSites, files };
}

// ------------------------------------------------------------ assembling

// AssemblerPlus that records errors instead of printing / aborting, so one
// pass reports every error.
class CollectingAssembler extends AssemblerPlus {
  constructor() {
    super();
    this.collected = [];
    this.registerExtension(display.assemblerExtension);
    this.registerExtension(far.assemblerExtension);
  }
  error(message) {
    this.collected.push({ lineNum: this.lineNum, locCtr: this.locCtr, message, pass: this.pass });
    this.errorFlag = true;
  }
  // Upstream emits no word when an encoder fails in pass 2 (e.g. pcoffset9 out of
  // range), so every later instruction lands one word below the address pass 1
  // gave its label. Hundreds of real far refs then made nearby short branches look
  // out of range too. Keep pass 2 in step with pass 1 by emitting a placeholder.
  handleInstruction(mnemonic, operands) {
    const loc = this.locCtr;
    const errs = this.collected.length;
    super.handleInstruction(mnemonic, operands);
    if (this.pass === 2 && this.locCtr === loc && this.collected.length > errs) {
      this.writeMachineWord(0);
      this.locCtr += 1;
    }
  }
}

function assembleOnce(lines, inputName) {
  const asm = new CollectingAssembler();
  asm.inputFileName = inputName;
  asm.sourceLines = lines;
  asm.throwOnAssemblyError = true;
  const origErr = console.error;
  const origLog = console.log;
  const noise = [];
  console.error = (...a) => noise.push(a.join(' '));
  console.log = (...a) => noise.push(a.join(' '));
  let thrown = null;
  try {
    asm.pass = 1; asm.locCtr = 0; asm.lineNum = 0; asm.errorFlag = false;
    asm.performPass();
    if (asm.locCtr === 0 && !asm.errorFlag) throw new Error('Empty program (no instructions or data)');
    // run pass 2 even after pass-1 errors so every error is reported at once
    asm.pass = 2; asm.locCtr = 0; asm.lineNum = 0;
    asm.performPass();
    if (!asm.errorFlag && asm.startLabel !== null && !Object.prototype.hasOwnProperty.call(asm.symbolTable, asm.startLabel)) {
      throw new Error(`.start label '${asm.startLabel}' is not defined`);
    }
  } catch (e) {
    thrown = e;
  } finally {
    console.error = origErr;
    console.log = origLog;
  }
  const errors = [];
  for (const e of asm.collected) if (!errors.some(x => x.lineNum === e.lineNum && x.message === e.message)) errors.push(e);
  if (thrown && !errors.some(e => e.lineNum === asm.lineNum && e.message === thrown.message)) {
    errors.push({ lineNum: asm.lineNum, locCtr: asm.locCtr, message: thrown.message, thrown: true });
  }
  return { asm, errors, thrown, failed: errors.length > 0 };
}

const hex4 = v => '0x' + (v & 0xFFFF).toString(16).padStart(4, '0');

function hintFor(message, sourceLine) {
  if (/pcoffset/i.test(message)) {
    return 'target is out of PC-relative reach and this form cannot be rewritten automatically; move the target closer or load its address from a pointer cell (p_x: .word x / ld r1, p_x)';
  }
  if (/imm5 out of range/i.test(message)) return 'add/sub/and/cmp immediates are -16..15: put the constant in a register first (mov r1, 100 / cmp r0, r1) or in a .word cell';
  if (/mov immediate value out of range|imm9/i.test(message)) return 'mov immediates are -256..255: use a .word cell and ld it (or .define the value and keep it small)';
  if (/offset6/i.test(message)) return 'ldr/str offsets are -32..31: add to the base register first';
  if (/^Invalid operation$/i.test(message)) return 'unknown mnemonic, or an instruction at column 0 (only labels may start in column 0 — indent instructions). Valid branches: br bre brz brne brnz brn brp brlt brgt brc brb bral (no brge/brle/brzp/brnc)';
  if (/Duplicate label/i.test(message)) return 'all labels are global (including @labels and labels in included files): prefix internal labels with the module/routine name';
  if (/Bad register/i.test(message)) return 'operand must be r0..r7 / fp / sp / lr — LCC+ traps like sleep/cursor/srand/present take a register, not an immediate';
  if (/Undefined label|Bad label/i.test(message)) return 'label is not defined anywhere (check spelling, and that the module defining it is .include-d); constants need .define NAME value';
  return null;
}

const MAX_ERRORS = 25;

// Build an .ap entry file. Options: { relax: true }
function build(entryFile, options = {}) {
  const relaxOn = options.relax !== false;
  const pre = preprocess(entryFile);
  const inputName = path.basename(entryFile).replace(/\.[^.]*$/, '') + '.ap';
  const lines = pre.lines.slice();
  const map = pre.map.slice();
  const diagnostics = [];
  const relaxed = [];
  let res;

  // A chain of near-limit branches can need one relaxation pass per branch, so
  // relaxation passes are bounded by the source size; error-recovery retries keep
  // their own cap of 60.
  const maxIter = lines.length + 60;
  for (let iter = 0, retries = 0; retries < 60 && iter < maxIter; iter++) {
    res = assembleOnce(lines, inputName);
    if (!res.failed) break;

    if (relaxOn) {
      // A line with another error too (undefined or bad label) also reports a bogus
      // pcoffset error: report it rather than rewrite it.
      const otherErr = new Set(res.errors.filter(e => !/pcoffset/i.test(e.message)).map(e => e.lineNum));
      const fixable = res.errors
        .filter(e => !e.thrown && /pcoffset/i.test(e.message) && !otherErr.has(e.lineNum))
        .map(e => ({ e, idx: e.lineNum - 1, rewrite: far.relaxLine(lines[e.lineNum - 1], `${iter}_${e.lineNum}`) }))
        .filter(x => x.rewrite);
      if (fixable.length) {
        // rewrite bottom-up so earlier indexes stay valid
        fixable.sort((a, b) => b.idx - a.idx);
        for (const x of fixable) {
          relaxed.push({ ...map[x.idx], text: lines[x.idx].trim(), extraWords: x.rewrite.extraWords });
          lines.splice(x.idx, 1, ...x.rewrite.lines);
          map.splice(x.idx, 1, ...x.rewrite.lines.map(() => map[x.idx]));
        }
        continue;
      }
    }

    // A thrown (aborting) error stops the pass early: record it, neutralise the
    // line and retry so later errors are reported too.
    const thrownErr = res.errors.find(e => e.thrown);
    for (const e of res.errors) {
      if (diagnostics.length >= MAX_ERRORS) break;
      const loc = map[e.lineNum - 1] || { file: path.resolve(entryFile), line: e.lineNum };
      if (diagnostics.some(d => d.file === loc.file && d.line === loc.line)) continue; // first error per line
      diagnostics.push({ file: loc.file, line: loc.line, source: lines[e.lineNum - 1], message: e.message, hint: hintFor(e.message, lines[e.lineNum - 1] || '') });
    }
    if (thrownErr && diagnostics.length < MAX_ERRORS && thrownErr.lineNum >= 1 && lines[thrownErr.lineNum - 1] !== undefined) {
      const ln = lines[thrownErr.lineNum - 1];
      const label = /label/i.test(thrownErr.message) ? null : (ln.match(/^([A-Za-z_$@][\w$@]*):/) || [])[1];
      const placeholder = `${label ? label + ':' : ''}        .word 0`;
      if (ln !== placeholder) { lines[thrownErr.lineNum - 1] = placeholder; retries++; continue; }
    }
    break;
  }
  if (diagnostics.length || res.failed) {
    if (!diagnostics.length) diagnostics.push({ file: path.resolve(entryFile), line: 0, message: 'assembly failed (could not resolve far references)' });
    diagnostics.sort((x, y) => (x.file === y.file ? x.line - y.line : x.file < y.file ? -1 : 1));
    throw new BuildError('Assembly failed', diagnostics);
  }

  const asm = res.asm;
  if (!asm.isLCCPlusFile) {
    throw new BuildError('Assembly failed', [{ file: path.resolve(entryFile), line: 1, message: 'Missing .lccplus directive (put "    .lccplus" near the top of the entry file)' }]);
  }

  asm.startAddress = asm.startLabel !== null ? asm.symbolTable[asm.startLabel] : 0;
  const bytes = asm.toOutputBuffer('p');

  const sourceMap = new Map();
  const listing = [];
  const fileWords = new Map();
  const labelsByFile = new Map();
  for (const entry of asm.listing) {
    const loc = map[entry.lineNum - 1] || { file: entryFile, line: entry.lineNum };
    const n = entry.codeWords ? entry.codeWords.length : 0;
    if (n > 0) {
      sourceMap.set(entry.locCtr, { file: loc.file, line: loc.line, text: (entry.sourceLine || '').trim() });
      fileWords.set(loc.file, (fileWords.get(loc.file) || 0) + n);
    }
    if (entry.label && !entry.label.startsWith('__far')) {
      if (!labelsByFile.has(loc.file)) labelsByFile.set(loc.file, []);
      labelsByFile.get(loc.file).push({ label: entry.label, line: loc.line });
    }
    listing.push({ addr: entry.locCtr, words: entry.codeWords || [], file: loc.file, line: loc.line, text: entry.sourceLine || '', label: entry.label });
  }

  const result = {
    entry: path.resolve(entryFile),
    bytes,
    symbols: { ...asm.symbolTable },
    defines: Object.fromEntries(pre.defines),
    sourceMap,
    listing,
    words: asm.outputBuffer.length,
    startAddress: asm.startAddress,
    files: pre.files,
    fileWords,
    labelsByFile,
    relaxed,
    flatLines: lines,
    map,
  };
  if (options.manifest) lintManifest(result, options.manifest, options.gameDir);
  return result;
}

// ------------------------------------------------------------ game manifests

// Resolve a CLI/test target (a game directory, a game.json, or an .ap file)
// into { entry, manifest, gameDir }.
function resolveTarget(target) {
  let p = path.resolve(target);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'game.json');
  if (p.endsWith('game.json')) {
    if (!fs.existsSync(p)) throw new BuildError('No game', [{ file: p, line: 0, message: 'no game.json here (pass an .ap file or a game directory with game.json)' }]);
    const manifest = loadManifest(p);
    return { entry: path.resolve(path.dirname(p), manifest.entry || 'main.ap'), manifest, gameDir: path.dirname(p) };
  }
  // an .ap file: pick up the manifest of the game it belongs to, if any
  for (let d = path.dirname(p), i = 0; i < 3; i++, d = path.dirname(d)) {
    const mf = path.join(d, 'game.json');
    if (fs.existsSync(mf)) {
      const manifest = loadManifest(mf);
      if (path.resolve(d, manifest.entry || 'main.ap') === p) return { entry: p, manifest, gameDir: d };
      break;
    }
  }
  return { entry: p, manifest: null, gameDir: path.dirname(p) };
}

function loadManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new BuildError('Bad game.json', [{ file, line: 0, message: `invalid JSON: ${e.message}` }]);
  }
}

// Enforce module ownership rules from game.json:
//   modules: { "src/foo.ap": { "prefix": "foo_", ... } }
// - every label defined in a module starts with its prefix
// - every listed module is actually part of the build
function lintManifest(result, manifest, gameDir) {
  const diags = [];
  const modules = manifest.modules || {};
  for (const [file, spec] of Object.entries(modules)) {
    const abs = path.resolve(gameDir, file);
    if (!result.files.includes(abs)) {
      diags.push({ file: path.join(gameDir, 'game.json'), line: 0, message: `module ${file} is listed in game.json but never .include-d by the build` });
      continue;
    }
    if (spec.prefix === undefined) continue;
    const prefixes = [].concat(spec.prefix);
    if (!prefixes.length) {
      for (const { label, line } of result.labelsByFile.get(abs) || []) diags.push({ file: abs, line, message: `label '${label}': this module may not define labels (game.json prefix is [] — defines/data only)` });
      continue;
    }
    for (const { label, line } of result.labelsByFile.get(abs) || []) {
      if (!prefixes.some(p => label.startsWith(p))) {
        diags.push({ file: abs, line, message: `label '${label}' must start with this module's prefix ${prefixes.map(p => `'${p}'`).join(' or ')} (game.json)`, hint: 'module prefixes keep labels unique when several agents edit different modules' });
      }
    }
  }
  if (manifest.budget && manifest.budget.words && result.words > manifest.budget.words) {
    diags.push({ file: path.join(gameDir, 'game.json'), line: 0, message: `program is ${result.words} words, over the budget of ${manifest.budget.words} in game.json` });
  }
  if (diags.length) throw new BuildError('Lint failed', diags);
}

function formatDiagnostics(diags) {
  const body = diags.map(d => `${rel(d.file)}:${d.line}: error: ${d.message}`
    + (d.source !== undefined && d.source !== null ? `\n    ${String(d.source).trim()}` : '')
    + (d.hint ? `\n    hint: ${d.hint}` : '')).join('\n');
  return diags.length > 1 ? `${body}\n${diags.length} errors` : body;
}

module.exports = { build, preprocess, resolveTarget, BuildError, formatDiagnostics, rel, hex4, ROOT, VENDOR, LIB_DIR };
