'use strict';
// Interactive player for humans: real terminal, real time, raw keyboard.
// Same extensions as the headless runner (present, farcall/farjump) and the
// fast interpreter core; terminal output is buffered and flushed once per
// frame so full-screen redraws don't flicker.

const path = require('path');
const { VENDOR } = require('./assemble');
const InterpreterPlus = require(path.join(VENDOR, 'src', 'plus', 'interpreterplus.js'));
const { TRAP_HALT } = require(path.join(VENDOR, 'src', 'core', 'constants.js'));
const { fastStep } = require('./fastcore');
const display = require('./display');
const far = require('./farops');

const BATCH = 20000;

class Player extends InterpreterPlus {
  constructor(opts = {}) {
    super();
    this.colorMode = opts.colorMode || display.detectColorMode();
    this.ansiTranslator = display.createAnsiTranslator(this.colorMode);
    this.outBuf = '';
    this._write = m => {
      this.outBuf += this.ansiTranslator.translate(String(m));
      if (this.outBuf.length > 65536) this.flush();
    };
    this.prevCells = new Map();
    this.lastBlockAddr = null;
    this.inAltScreen = false;
    this._onResize = () => this.handleResize();
  }

  _paintCanvas() {
    return display.fillCanvasAnsi(process.stdout.rows || 30, process.stdout.columns || 100, this.colorMode);
  }

  enterScreen() {
    if (!process.stdout.isTTY || this.inAltScreen) return;
    this.inAltScreen = true;
    this.ansiTranslator.reset();
    process.stdout.write('\x1b[?1049h' + this._paintCanvas());
    process.stdout.on('resize', this._onResize);
  }

  leaveScreen() {
    process.stdout.removeListener('resize', this._onResize);
    if (!process.stdout.isTTY || !this.inAltScreen) return;
    this.inAltScreen = false;
    process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  }

  handleResize() {
    if (!this.inAltScreen || !this.running) return;
    this.flush();
    this.prevCells.clear();
    this.ansiTranslator.reset();
    let out = this._paintCanvas();
    if (this.lastBlockAddr !== null) {
      try {
        out += display.presentToAnsi(this.mem, this.lastBlockAddr, this.prevCells, { colorMode: this.colorMode });
      } catch (_) { /* ignore if block is mid-update */ }
    }
    process.stdout.write(out);
  }

  flush() {
    if (this.outBuf) { process.stdout.write(this.outBuf); this.outBuf = ''; }
  }

  step() { return fastStep.call(this); }

  executeTRAP() {
    switch (this.trapvec) {
      case far.TRAP_FARCALL: case far.TRAP_FARJUMP: far.execFarTrap(this); return;
      case display.TRAP_PRESENT:
        try {
          this.lastBlockAddr = this.r[this.sr];
          this.outBuf += display.presentToAnsi(this.mem, this.lastBlockAddr, this.prevCells, { colorMode: this.colorMode });
          this.ansiTranslator.reset();
        } catch (e) { this.raiseRuntimeError(e); }
        this.screenManipulated = true;
        return;
      case TRAP_HALT:
        this.flush();
        this.leaveScreen();
        break;
      default: break;
    }
    return super.executeTRAP();
  }

  // Terminal-changing traps: flush text first so ordering is preserved; a clear
  // also invalidates the present() diff cache and repaints the opaque canvas.
  executeClear() {
    this.flush();
    this.prevCells.clear();
    this.lastBlockAddr = null;
    this.ansiTranslator.reset();
    process.stdout.write(this._paintCanvas());
    this.screenManipulated = true;
  }
  executeResetCursor() { this.outBuf += '\x1b[H'; this.screenManipulated = true; }
  executeToggleCursor() { this.outBuf += this.r[this.dr] === 0 ? '\x1b[?25l' : '\x1b[?25h'; this.screenManipulated = true; }
  executeSleep() { this.flush(); super.executeSleep(); }
  executeNonBlockingAsciiInput() {
    if (!this.keyQueue.length) this.flush();
    super.executeNonBlockingAsciiInput();
  }
  readCharFromStdin() { this.flush(); return super.readCharFromStdin(); }
  readLineFromStdin() { this.flush(); return super.readLineFromStdin(); }
  handleRuntimeError(error) {
    this.flush();
    this.leaveScreen();
    return super.handleRuntimeError(error);
  }

  startNonBlockingLoop() {
    this.enterScreen();
    this.running = true;
    const runBatch = () => {
      if (!this.running) return;
      try {
        for (let i = 0; i < BATCH && this.running; i++) this.step();
      } catch (error) {
        this.handleRuntimeError(error);
        return;
      }
      if (this.running) setImmediate(runBatch);
      else this.flush();
    };
    runBatch();
  }
}

function play(epFile, opts = {}) {
  const p = new Player(opts);
  const cleanup = () => { try { p.leaveScreen(); } catch (_) { /* ignore */ } };
  process.on('exit', cleanup);
  process.once('SIGINT', () => { cleanup(); process.exit(130); });
  process.once('SIGTERM', () => { cleanup(); process.exit(143); });
  p.generateStats = false;
  p.main([epFile]);
}

module.exports = { play, Player };
