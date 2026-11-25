'use strict';
// One SCRAPCORE run for one network player: the LCC+ interpreter in real time,
// with every terminal side effect sent to `onOutput` (an SSH channel) instead of
// the server's own stdin/stdout. Many of these share one Node process.

const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { VENDOR } = require(path.join(ROOT, 'tools/lib/assemble'));
const InterpreterPlus = require(path.join(VENDOR, 'src', 'plus', 'interpreterplus.js'));
const { TRAP_HALT } = require(path.join(VENDOR, 'src', 'core', 'constants.js'));
const { fastStep } = require(path.join(ROOT, 'tools/lib/fastcore'));
const display = require(path.join(ROOT, 'tools/lib/display'));
const far = require(path.join(ROOT, 'tools/lib/farops'));

const BATCH = 20000;
const GAME = { TITLE: 0, PLAY: 1, DEAD: 2, WON: 3 };

class RaceGame extends InterpreterPlus {
  // opts: { build, seed, race, colorMode, rows, cols, onOutput(str), onExit(reason, detail) }
  constructor(opts) {
    super();
    this.opts = opts;
    this.sym = opts.build.symbols;
    this.colorMode = opts.colorMode || 'truecolor';
    this.termRows = opts.rows || 31;
    this.termCols = opts.cols || 100;
    this.translator = display.createAnsiTranslator(this.colorMode);
    this._write = m => this.opts.onOutput(this.translator.translate(String(m)));
    this.prevCells = new Map();
    this.nonBlockingInput = true;
    this.seedServed = false;
    this.stopped = false;
    this.timer = null;
    this.generateStats = false;
  }

  start() {
    this.loadExecutableBuffer(Buffer.from(this.opts.build.bytes), 'p');
    this.spInitial = this.r[6];
    if (this.opts.race) this.poke('st_race', 1);
    this.keyQueue.push(' ');          // skip the title screen: everyone starts together
    this.resume();
  }

  // ---- memory ---------------------------------------------------------------
  peek(name) {
    const v = this.mem[this.sym[name]];
    return v & 0x8000 ? v - 0x10000 : v;
  }
  poke(name, value) { this.mem[this.sym[name]] = value & 0xFFFF; }

  stats() {
    return {
      state: this.peek('st_game_state'),
      depth: this.peek('st_depth'),
      best: this.peek('st_depth_best'),
      core: this.peek('st_core_hp'),
      turns: this.peek('st_turn'),
      kills: this.peek('st_kills'),
    };
  }

  // ---- input / screen -------------------------------------------------------
  pushKeys(chunk) {
    for (const ch of chunk) this.keyQueue.push(ch === '\r' || ch === '\n' ? '\n' : ch);
    if (this.keyQueue.length > 64) this.keyQueue.splice(0, this.keyQueue.length - 64);
  }

  // Repaint everything (after a resize or when the server drew over the screen).
  repaint(rows, cols) {
    if (rows) this.termRows = rows;
    if (cols) this.termCols = cols;
    this.prevCells.clear();
    let out = display.fillCanvasAnsi(this.termRows, this.termCols, this.colorMode);
    if (this.lastBlockAddr != null) {
      try { out += display.presentToAnsi(this.mem, this.lastBlockAddr, this.prevCells, { colorMode: this.colorMode }); } catch (_) { /* mid-update */ }
    }
    this.opts.onOutput(out);
  }

  // ---- run loop -------------------------------------------------------------
  resume() {
    if (this.stopped) return;
    this.running = true;
    setImmediate(() => this.runBatch());
  }

  runBatch() {
    if (this.stopped || !this.running) return;
    try {
      for (let i = 0; i < BATCH && this.running; i++) fastStep.call(this);
    } catch (e) {
      this.finish('error', e && e.message ? e.message : String(e));
      return;
    }
    if (this.running && !this.stopped) setImmediate(() => this.runBatch());
  }

  stop() {
    this.stopped = true;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  finish(reason, detail) {
    if (this.stopped) return;
    this.stop();
    this.opts.onExit(reason, detail);
  }

  // ---- traps: nothing may touch the server's own terminal or process ---------
  executeTRAP() {
    switch (this.trapvec) {
      case far.TRAP_FARCALL: case far.TRAP_FARJUMP: far.execFarTrap(this); return;
      case display.TRAP_PRESENT:
        this.lastBlockAddr = this.r[this.sr];
        this.opts.onOutput(display.presentToAnsi(this.mem, this.lastBlockAddr, this.prevCells, { colorMode: this.colorMode }));
        this.translator.reset();
        return;
      case TRAP_HALT:
        this.finish('halt');
        return;
      default:
        return super.executeTRAP();
    }
  }

  executeSleep() {
    this.running = false;
    this.timer = setTimeout(() => { this.timer = null; this.resume(); }, this.r[this.sr]);
  }
  executeMillis() {
    // The first read seeds the RNG (main_start), so it is the match seed for every racer.
    if (!this.seedServed) { this.seedServed = true; this.r[this.dr] = this.opts.seed & 0xFFFF; return; }
    this.r[this.dr] = Date.now() % 1000;
  }
  executeClear() { this.repaint(); }
  executeResetCursor() { this.opts.onOutput('\x1b[H'); }
  executeToggleCursor() { this.opts.onOutput(this.r[this.dr] === 0 ? '\x1b[?25l' : '\x1b[?25h'); }
  executeSound() { /* no sound over SSH */ }
  executeBoop() { /* no sound over SSH */ }
  executeWho() { /* no name.nnn */ }
  executeLccPlusBreakpoint() { /* ignore bp */ }
  readCharFromStdin() { throw new Error('blocking input is not supported over SSH'); }
  readLineFromStdin() { throw new Error('blocking input is not supported over SSH'); }
  raiseRuntimeError(e) { throw (e instanceof Error ? e : new Error(String(e))); }
  handleRuntimeError(e) { this.finish('error', e && e.message ? e.message : String(e)); }
}

module.exports = { RaceGame, GAME };
