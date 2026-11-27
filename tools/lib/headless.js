'use strict';
// Deterministic, headless LCC+ runner.
//
// Time model: a virtual clock. `sleep rN` advances it by rN ms instantly;
// every executed instruction advances it by `usPerInstr` microseconds.
// `millis` reads the virtual clock, so runs are fully reproducible.
//
// Frame model: a *frame boundary* happens at every `sleep`, and also when the
// program polls `nbain` IDLE_POLLS times in a row with nothing in the queue
// (a busy-wait "press a key" loop), and when a blocking read (ain/din/sin/hin)
// needs input. At each boundary the screen is snapshotted and the next batch
// from the key script is delivered.

const path = require('path');
const { VENDOR } = require('./assemble');
const VTerm = require('./vterm');
const InterpreterPlus = require(path.join(VENDOR, 'src', 'plus', 'interpreterplus.js'));
const { TRAP_HALT, TRAP_SOUND_LITERAL_FLAG } = require(path.join(VENDOR, 'src', 'core', 'constants.js'));

const { fastStep } = require('./fastcore');
const display = require('./display');
const far = require('./farops');
const IDLE_POLLS = 64;
const SOUND_NAMES = ['ding', 'doink', 'beep', 'ping', 'popsound', 'softbeep', 'bop'];

class StopRun {
  constructor(status, detail) { this.status = status; this.detail = detail; }
}

class HeadlessInterpreter extends InterpreterPlus {
  constructor(session) {
    super();
    this.session = session;
    this._write = m => session.vt.write(m);
    this.echoInput = false;           // raw-mode terminals don't echo
    this.nonBlockingInput = false;
    this.disableInfiniteLoopDetection = true;
  }

  step() {
    return this.session.slow ? super.step() : fastStep.call(this);
  }

  executeTRAP() {
    if (this.trapvec === TRAP_HALT) { this.running = false; return; }
    if (this.trapvec === far.TRAP_FARCALL || this.trapvec === far.TRAP_FARJUMP) { far.execFarTrap(this); return; }
    if (this.trapvec === display.TRAP_PRESENT) {
      try { display.presentToVTerm(this.session.vt, this.mem, this.r[this.sr]); } catch (e) { this.raiseRuntimeError(e); }
      this.session.presents++;
      return;
    }
    return super.executeTRAP();
  }

  executeClear() { this.session.vt.clearAll(); this.session.vt.home(); }
  executeResetCursor() { this.session.vt.home(); }
  executeToggleCursor() { this.session.vt.cursorVisible = this.r[this.dr] !== 0; }
  executeWho() { /* no name.nnn in headless runs */ }
  executeMillis() { this.r[this.dr] = Math.floor(this.session.clockMs()) % 1000; }

  executeSound() {
    const slot = (this.ir & TRAP_SOUND_LITERAL_FLAG) ? this.sr : this.r[this.sr];
    this.session.event('sound', SOUND_NAMES[slot] || `slot${slot}`);
  }

  executeSleep() {
    this.session.vclockMs += this.r[this.sr];
    this.session.idle = 0;
    this.session.boundary('sleep');
  }

  executeLccPlusBreakpoint() {
    this.session.event('bp', `pc=0x${(this.pc - 1).toString(16)}`);
    this.session.snapshot('bp');
  }

  executeNonBlockingAsciiInput() {
    const s = this.session;
    if (s.keyQueue.length) {
      this.r[this.dr] = s.keyQueue.shift().charCodeAt(0);
      s.idle = 0;
    } else {
      this.r[this.dr] = 0;
      if (++s.idle >= IDLE_POLLS) { s.idle = 0; s.boundary('idle'); }
    }
  }

  _fillBlocking() {
    const s = this.session;
    while (!this.inputBuffer || this.inputBuffer.length === 0) {
      if (s.keyQueue.length) {
        this.inputBuffer = s.keyQueue.join('').replace(/\r/g, '\n');
        s.keyQueue = [];
        break;
      }
      if (s.frame >= s.lastScriptFrame) throw new StopRun('waiting-for-input', 'program is blocked on ain/din/sin/hin and the key script is exhausted');
      s.boundary('blocking-read');
    }
  }

  readCharFromStdin() { this._fillBlocking(); return super.readCharFromStdin(); }
  readLineFromStdin() { this._fillBlocking(); return super.readLineFromStdin(); }
}

class Session {
  constructor(build, opts = {}) {
    this.build = build;
    this.vt = new VTerm(opts.rows || 30, opts.cols || 100);
    this.batches = opts.batches || [];
    this.tail = opts.tail === undefined ? 1 : opts.tail;
    this.lastScriptFrame = this.batches.length - 1;
    this.stopAfterFrame = opts.frames !== undefined ? opts.frames - 1 : Math.max(0, this.batches.length - 1 + this.tail);
    this.maxSteps = opts.maxSteps || 100_000_000;          // whole run
    this.maxFrameSteps = opts.maxFrameSteps || 2_000_000;   // between two frame boundaries
    this.frameStartStep = 0;
    this.usPerInstr = opts.usPerInstr === undefined ? 1 : opts.usPerInstr;
    this.vclockMs = opts.clockStart || 0;
    this.watch = opts.watch || [];
    this.keepFrames = opts.keepFrames !== false;
    this.slow = !!opts.slow;
    this.profile = !!opts.profile;   // use upstream Interpreter#step (reference semantics)
    this.frame = 0;
    this.presents = 0;
    this.idle = 0;
    this.keyQueue = [];
    this.frames = [];
    this.events = [];
    this.lastText = null;
    this.lastColors = null;
    this.lastBg = null;
    this.interp = new HeadlessInterpreter(this);
  }

  clockMs() { return this.vclockMs + (this.interp.instructionsExecuted * this.usPerInstr) / 1000; }

  event(type, detail) { this.events.push({ frame: this.frame, step: this.interp.instructionsExecuted, type, detail }); }

  deliver(k) {
    const keys = this.batches[k];
    if (keys) for (const ch of keys) this.keyQueue.push(ch);
  }

  snapshot(reason) {
    if (!this.keepFrames) return;
    const text = this.vt.text();
    const colors = this.vt.colorText();
    const bg = this.vt.colorText(true);
    this.frames.push({
      frame: this.frame,
      reason,
      timeMs: Math.round(this.clockMs()),
      step: this.interp.instructionsExecuted,
      text,
      colors,
      bg,
      changed: text !== this.lastText,
      colorChanged: colors !== this.lastColors || bg !== this.lastBg,
      watch: this.readWatch(),
    });
    this.lastText = text;
    this.lastColors = colors;
    this.lastBg = bg;
  }

  boundary(reason) {
    this.snapshot(reason);
    if (this.frame >= this.stopAfterFrame) throw new StopRun('frames-complete');
    this.frame++;
    this.frameStartStep = this.interp.instructionsExecuted;
    this.deliver(this.frame);
  }

  readWatch() {
    const out = {};
    for (const w of this.watch) out[w.spec] = readSymbol(this.interp.mem, this.build.symbols, w);
    return out;
  }

  run(bytes) {
    const it = this.interp;
    const origErr = console.error;
    const errLines = [];
    console.error = (...a) => errLines.push(a.join(' '));
    let status = 'halted';
    let detail = null;
    const hot = new Uint32Array(65536);
    try {
      it.loadExecutableBuffer(Buffer.from(bytes), 'p');
      it.spInitial = it.r[6];
      it.running = true;
      this.deliver(0);
      while (it.running) {
        if (it.instructionsExecuted >= this.maxSteps || it.instructionsExecuted - this.frameStartStep >= this.maxFrameSteps) {
          status = 'step-limit';
          detail = it.instructionsExecuted >= this.maxSteps
            ? `exceeded the ${this.maxSteps}-instruction run budget (raise with --max-steps)`
            : `frame ${this.frame} ran ${this.maxFrameSteps} instructions without a frame boundary — infinite loop, or a loop with no sleep (raise with --max-frame-steps)`;
          this.snapshot('step-limit');
          break;
        }
        hot[it.pc]++;
        it.step();
      }
      if (status === 'halted') this.snapshot('halt');
    } catch (e) {
      if (e instanceof StopRun) {
        status = e.status;
        detail = e.detail || null;
        if (status !== 'frames-complete') this.snapshot(status);
      } else {
        status = 'runtime-error';
        detail = e && e.message ? e.message : String(e);
        this.snapshot('error');
      }
    } finally {
      console.error = origErr;
    }

    const pc = status === 'runtime-error' ? (it.pc - 1) & 0xFFFF : it.pc;
    const result = {
      status,
      detail,
      steps: it.instructionsExecuted,
      frame: this.frame,
      timeMs: Math.round(this.clockMs()),
      pc,
      pcSource: this.build.sourceMap.get(pc) || null,
      registers: Array.from(it.r),
      flags: { n: it.n, z: it.z, c: it.c, v: it.v },
      size: `${this.vt.rows}x${this.vt.cols}`,
      screen: this.vt.text(),
      colors: this.vt.colorText(),
      bg: this.vt.colorText(true),
      presents: this.presents,
      cursorVisible: this.vt.cursorVisible,
      bells: this.vt.bells,
      frames: this.frames,
      events: this.events,
      watch: this.readWatch(),
      unconsumedKeys: (this.keyQueue.join('') + (it.inputBuffer || '')).replace(/^\n$/, ''),
      stderr: errLines,
      mem: it.mem,
    };
    if (this.profile) result.hotCounts = hot;
    if (status === 'step-limit' || status === 'runtime-error') {
      const hotList = [];
      for (let a = 0; a < 65536; a++) if (hot[a]) hotList.push([a, hot[a]]);
      hotList.sort((x, y) => y[1] - x[1]);
      result.hotspots = hotList.slice(0, 8).map(([a, n]) => ({ addr: a, count: n, src: this.build.sourceMap.get(a) || null }));
    }
    return result;
  }
}

// Watch spec:  name | name:N (N words) | name:s (string) | name@0x10 (raw address)
function parseWatch(spec) {
  return spec.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^([^:]+?)(?::(\d+|s))?$/);
    if (!m) throw new Error(`Bad watch spec "${s}"`);
    return { spec: s, name: m[1], count: m[2] === 's' ? 's' : (m[2] ? parseInt(m[2], 10) : 1) };
  });
}

function resolveAddress(symbols, name) {
  if (/^(0x[0-9a-f]+|\d+)$/i.test(name)) return parseInt(name, name.toLowerCase().startsWith('0x') ? 16 : 10);
  if (!Object.prototype.hasOwnProperty.call(symbols, name)) return null;
  return symbols[name];
}

function toSigned(v) { return v & 0x8000 ? v - 0x10000 : v; }

function readSymbol(mem, symbols, w) {
  const addr = resolveAddress(symbols, w.name);
  if (addr === null) return `<no label ${w.name}>`;
  if (w.count === 's') {
    let s = '';
    for (let a = addr; mem[a & 0xFFFF] !== 0 && s.length < 400; a++) s += String.fromCharCode(mem[a & 0xFFFF]);
    return s;
  }
  if (w.count === 1) return toSigned(mem[addr]);
  return Array.from({ length: w.count }, (_, i) => toSigned(mem[(addr + i) & 0xFFFF]));
}

function runHeadless(build, opts) {
  const session = new Session(build, opts);
  return session.run(build.bytes);
}

module.exports = { runHeadless, parseWatch, readSymbol, toSigned, IDLE_POLLS };
