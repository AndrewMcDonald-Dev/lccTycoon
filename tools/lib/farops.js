'use strict';
// Far references. LCC's PC-relative forms reach only ±256 words (br*, ld, st,
// lea) or ±1024 (bl). When the build reports such a reference out of range, the
// line is rewritten into an equivalent far form (registers and flags preserved):
//
//   bl X          ->  farcall / .word X                 (trap 0xF1: lr = return, pc = X)
//   br X          ->  farjump / .word X                 (trap 0xF2: pc = X)
//   brCC X        ->  brCC t / br s / t: farjump / .word X / s:
//   ld rD, X      ->  ld rD, p / br s / p: .word X / s: ldr rD, rD, 0
//   lea rD, X     ->  ld rD, p / br s / p: .word X / s:
//   st rS, X      ->  push rT / ld rT, p / br s / p: .word X / s: str rS, rT, 0 / pop rT
//
// farcall/farjump read the word after the trap as an absolute address.

const TRAP_FARCALL = 0x00F1;
const TRAP_FARJUMP = 0x00F2;

const assemblerExtension = {
  mnemonics: {
    farcall: { trapVec: TRAP_FARCALL, operandShape: '(none)' },
    farjump: { trapVec: TRAP_FARJUMP, operandShape: '(none)' },
  },
};

// Runtime: call with the interpreter as `this` from executeTRAP.
function execFarTrap(it) {
  const target = it.mem[it.pc & 0xFFFF];
  if (it.trapvec === TRAP_FARCALL) it.r[7] = (it.pc + 1) & 0xFFFF;
  it.pc = target & 0xFFFF;
}

const REG = { r0: 'r0', r1: 'r1', r2: 'r2', r3: 'r3', r4: 'r4', r5: 'r5', r6: 'r6', r7: 'r7', fp: 'r5', sp: 'r6', lr: 'r7' };
const BRANCHES = new Set(['br', 'bral', 'brz', 'bre', 'brnz', 'brne', 'brn', 'brp', 'brlt', 'brgt', 'brc', 'brb']);
const LINE = /^\s*(?:([A-Za-z_$@][\w$@]*):)?\s*([A-Za-z]+)\s+([^;]*?)\s*(;.*)?$/;

// Returns { lines, extraWords } or null if the line has no far form.
function relaxLine(line, id) {
  if (line === undefined) return null;
  const m = line.match(LINE);
  if (!m) return null;
  const [, label, mnemonicRaw, operandText] = m;
  const mn = mnemonicRaw.toLowerCase();
  const ops = operandText.split(',').map(s => s.trim()).filter(Boolean);
  const L = label ? `${label}:` : '';
  const ind = '        ';
  const p = `__far${id}_p`;
  const s = `__far${id}_s`;
  const t = `__far${id}_t`;

  if ((mn === 'bl' || mn === 'call' || mn === 'jsr') && ops.length === 1) {
    return { lines: [`${L}${ind}farcall`, `${ind}.word ${ops[0]}`], extraWords: 1 };
  }
  if (BRANCHES.has(mn) && ops.length === 1) {
    if (mn === 'br' || mn === 'bral') return { lines: [`${L}${ind}farjump`, `${ind}.word ${ops[0]}`], extraWords: 1 };
    return { lines: [`${L}${ind}${mn} ${t}`, `${ind}br ${s}`, `${t}:${ind}farjump`, `${ind}.word ${ops[0]}`, `${s}:`], extraWords: 3 };
  }
  if ((mn === 'ld' || mn === 'lea') && ops.length === 2 && REG[ops[0].toLowerCase()]) {
    const rd = ops[0];
    const tail = mn === 'ld' ? [`${s}:${ind}ldr ${rd}, ${rd}, 0`] : [`${s}:`];
    return { lines: [`${L}${ind}ld ${rd}, ${p}`, `${ind}br ${s}`, `${p}:${ind}.word ${ops[1]}`, ...tail], extraWords: mn === 'ld' ? 3 : 2 };
  }
  if (mn === 'st' && ops.length === 2 && REG[ops[0].toLowerCase()]) {
    const rs = ops[0];
    const tmp = REG[rs.toLowerCase()] === 'r0' ? 'r1' : 'r0';
    return {
      lines: [`${L}${ind}push ${tmp}`, `${ind}ld ${tmp}, ${p}`, `${ind}br ${s}`, `${p}:${ind}.word ${ops[1]}`, `${s}:${ind}str ${rs}, ${tmp}, 0`, `${ind}pop ${tmp}`],
      extraWords: 5,
    };
  }
  return null;
}

module.exports = { TRAP_FARCALL, TRAP_FARJUMP, assemblerExtension, execFarTrap, relaxLine };
