'use strict';
// Faster drop-in replacement for Interpreter#step() (no trace/debug support).
// The upstream step() allocates a decode object and copies the register file on
// every instruction; this version decodes through a cache and writes the
// fields the execute* handlers read directly. Semantics are identical (checked
// by tools/selftest.js against upstream step()).

const MAX_MEMORY = 65536;
const cache = new Array(65536);

function decodeWord(it, ir) {
  let d = cache[ir];
  if (d === undefined) {
    d = it.decode(ir);
    cache[ir] = d;
  }
  return d;
}

function fastStep() {
  const ir = this.mem[this.pc];
  this.pc = (this.pc + 1) & 0xFFFF;
  this.ir = ir;
  const d = decodeWord(this, ir);
  this.opcode = d.opcode;
  this.code = d.code; this.dr = d.dr; this.sr = d.sr;
  this.sr1 = d.sr1; this.baser = d.baser; this.sr2 = d.sr2;
  this.bit5 = d.bit5; this.bit11 = d.bit11;
  this.imm5 = d.imm5; this.pcoffset9 = d.pcoffset9; this.imm9 = d.imm9;
  this.pcoffset11 = d.pcoffset11; this.offset6 = d.offset6;
  this.eopcode = d.eopcode; this.trapvec = d.trapvec;

  switch (d.opcode) {
    case 0: this.executeBR(); break;
    case 1: this.executeADD(); break;
    case 2: this.executeLD(); break;
    case 3: this.executeST(); break;
    case 4: this.executeBLorBLR(); break;
    case 5: this.executeAND(); break;
    case 6: this.executeLDR(); break;
    case 7: this.executeSTR(); break;
    case 8: this.executeCMP(); break;
    case 9: this.executeNOT(); break;
    case 10: this.executeCase10(); break;
    case 11: this.executeSUB(); break;
    case 12: this.executeJMP(); break;
    case 13: this.executeMVI(); break;
    case 14: this.executeLEA(); break;
    default: this.executeTRAP(); break;
  }
  this.flagsSet = false;
  this.hasJumped = false;
  this.instructionsExecuted++;
  const sp = this.r[6];
  const stackSize = sp === 0 ? 0 : MAX_MEMORY - sp;
  if (stackSize > this.maxStackSize) this.maxStackSize = stackSize;
}

module.exports = { fastStep };
