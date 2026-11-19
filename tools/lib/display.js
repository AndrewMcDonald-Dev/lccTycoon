'use strict';
// "Text-mode video" extension for LCC+ — the project's one addition to the ISA.
//
//   present rN      ; trap 0xF0. rN = address of a display block:
//
//   word 0: cols (1..200)     word 1: rows (1..100)
//   word 2: top row on the terminal (0-based)   word 3: left column
//   word 4 .. 4+cols*rows-1: cells, row-major
//
// Cell word:  bits 0-7  glyph (code page 437: 32-126 ASCII, 176-178 shades,
//                       179-218 box drawing, 219-223 blocks, 0 = space)
//             bits 8-11 foreground color, bits 12-15 background color
//             (0 black 1 red 2 green 3 yellow 4 blue 5 magenta 6 cyan 7 white,
//              8-15 = bright versions). Attribute byte 0 = terminal default colors.
//
// One `present` copies the whole block to the screen (only changed cells are
// redrawn in a real terminal), so games build frames in memory and present once.

const TRAP_PRESENT = 0x00F0;

// CP437 -> Unicode for 0..255 (0 rendered as space).
const CP437 =
  ' ☺☻♥♦♣♠•◘○◙♂♀♪♫☼►◄↕‼¶§▬↨↑↓→←∟↔▲▼' +
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~⌂' +
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const GLYPHS = Array.from(CP437);
if (GLYPHS.length !== 256) throw new Error(`CP437 table has ${GLYPHS.length} entries`);

function sgrFor(attr) {
  if (!attr) return '';
  const fg = attr & 0xF;
  const bg = (attr >> 4) & 0xF;
  return `${fg < 8 ? 30 + fg : 90 + fg - 8};${bg < 8 ? 40 + bg : 100 + bg - 8}`;
}

class DisplayError extends Error {}

// Read a display block from memory. Returns { cols, rows, top, left, base }.
function readBlock(mem, addr) {
  const cols = mem[addr & 0xFFFF];
  const rows = mem[(addr + 1) & 0xFFFF];
  const top = mem[(addr + 2) & 0xFFFF];
  const left = mem[(addr + 3) & 0xFFFF];
  if (cols < 1 || cols > 200 || rows < 1 || rows > 100 || top > 200 || left > 400) {
    throw new DisplayError(`present: bad display block at 0x${addr.toString(16)} (cols=${cols} rows=${rows} top=${top} left=${left}); expected words [cols 1-200, rows 1-100, top, left, cells...]`);
  }
  return { cols, rows, top, left, base: (addr + 4) & 0xFFFF };
}

// Draw a block into a VTerm (headless).
function presentToVTerm(vt, mem, addr) {
  const b = readBlock(mem, addr);
  for (let r = 0; r < b.rows; r++) {
    const y = b.top + r;
    if (y >= vt.rows) break;
    for (let c = 0; c < b.cols; c++) {
      const x = b.left + c;
      if (x >= vt.cols) break;
      const w = mem[(b.base + r * b.cols + c) & 0xFFFF];
      vt.grid[y][x] = GLYPHS[w & 0xFF];
      vt.attr[y][x] = sgrFor(w >> 8);
    }
  }
  vt.dirty = true;
  return b;
}

// Build the ANSI string to update a real terminal; `prev` is a Map keyed by
// screen position remembering what is already drawn there.
function presentToAnsi(mem, addr, prev) {
  const b = readBlock(mem, addr);
  let out = '';
  let curSgr = null;
  for (let r = 0; r < b.rows; r++) {
    let pendingMove = true;
    for (let c = 0; c < b.cols; c++) {
      const w = mem[(b.base + r * b.cols + c) & 0xFFFF];
      const key = (b.top + r) * 1024 + b.left + c;
      if (prev.get(key) === w) { pendingMove = true; continue; }
      prev.set(key, w);
      if (pendingMove) { out += `\x1b[${b.top + r + 1};${b.left + c + 1}H`; pendingMove = false; }
      const sgr = sgrFor(w >> 8);
      if (sgr !== curSgr) { out += `\x1b[0${sgr ? ';' + sgr : ''}m`; curSgr = sgr; }
      out += GLYPHS[w & 0xFF];
    }
  }
  if (out) out += '\x1b[0m';
  return out;
}

module.exports = { TRAP_PRESENT, GLYPHS, sgrFor, readBlock, presentToVTerm, presentToAnsi, DisplayError,
  assemblerExtension: { mnemonics: { present: { trapVec: TRAP_PRESENT, operandShape: '[sr]' } } } };
