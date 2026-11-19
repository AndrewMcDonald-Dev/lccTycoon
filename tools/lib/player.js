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
  constructor() {
    super();
    this.outBuf = '';
    this._write = m => { this.outBuf += m; if (this.outBuf.length > 65536) this.flush(); };
    this.prevCells = new Map();
  }

  flush() {
    if (this.outBuf) { process.stdout.write(this.outBuf); this.outBuf = ''; }
  }

  step() { return fastStep.call(this); }

  executeTRAP() {
    switch (this.trapvec) {
      case far.TRAP_FARCALL: case far.TRAP_FARJUMP: far.execFarTrap(this); return;
      case display.TRAP_PRESENT:
        try { this.outBuf += display.presentToAnsi(this.mem, this.r[this.sr], this.prevCells); } catch (e) { this.raiseRuntimeError(e); }
        this.screenManipulated = true;
        return;
      case TRAP_HALT: this.flush(); break;
      default: break;
    }
    return super.executeTRAP();
  }

  // Terminal-changing traps: flush text first so ordering is preserved; a clear
  // also invalidates the present() diff cache.
  executeClear() { this.flush(); this.prevCells.clear(); process.stdout.write('\x1b[2J\x1b[H'); this.screenManipulated = true; }
  executeResetCursor() { this.outBuf += '\x1b[H'; this.screenManipulated = true; }
  executeToggleCursor() { this.outBuf += this.r[this.dr] === 0 ? '\x1b[?25l' : '\x1b[?25h'; this.screenManipulated = true; }
  executeSleep() { this.flush(); super.executeSleep(); }
  executeNonBlockingAsciiInput() {
    if (!this.keyQueue.length) this.flush();
    super.executeNonBlockingAsciiInput();
  }
  readCharFromStdin() { this.flush(); return super.readCharFromStdin(); }
  readLineFromStdin() { this.flush(); return super.readLineFromStdin(); }
  handleRuntimeError(error) { this.flush(); return super.handleRuntimeError(error); }

  startNonBlockingLoop() {
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

function play(epFile) {
  process.on('exit', () => { try { process.stdout.write('\x1b[0m\x1b[?25h'); } catch (_) { /* ignore */ } });
  const p = new Player();
  p.generateStats = false;
  p.main([epFile]);
}

module.exports = { play, Player };
