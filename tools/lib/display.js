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

// Self-contained 16-color RGB palette for interactive terminal play.
// Keeps games consistent regardless of the user's terminal theme and ensures an
// explicit opaque background (never terminal default / see-through).
// Dark colors 1..6 use brighter foregrounds (legible on the dark canvas, e.g.
// remembered tiles in blue) and deeper backgrounds (high contrast under bright
// text, target highlights, ride symbols, and visible FG_BLUE-on-BG_BLUE water).
const FG_PALETTE = [
  [ 17,  19,  26], // 0  black    #11131a (dark ink on bright bars/cursors)
  [224,  82,  82], // 1  red      #e05252
  [ 68, 179,  96], // 2  green    #44b360
  [217, 168,  62], // 3  yellow   #d9a83e
  [ 86, 138, 224], // 4  blue     #568ae0
  [189,  98, 217], // 5  magenta  #bd62d9
  [ 64, 184, 196], // 6  cyan     #40b8c4
  [202, 208, 220], // 7  white    #cad0dc (default text)
  [120, 130, 150], // 8  gray     #788296 (dim text, empty bars)
  [255, 102, 102], // 9  bred     #ff6666
  [ 98, 232, 120], // 10 bgreen   #62e878
  [255, 219,  77], // 11 byellow  #ffdb4d
  [108, 180, 255], // 12 bblue    #6cb4ff
  [242, 124, 255], // 13 bmagenta #f27cff
  [ 94, 232, 238], // 14 bcyan    #5ee8ee
  [245, 247, 255], // 15 bwhite   #f5f7ff
];

const BG_PALETTE = [
  [ 17,  19,  26], // 0  black    #11131a (opaque canvas; avoids #000000 so transparent terms keep it solid)
  [122,  30,  36], // 1  red      #7a1e24
  [ 28,  92,  48], // 2  green    #1c5c30
  [ 96,  68,  16], // 3  yellow   #604410
  [ 28,  58, 114], // 4  blue     #1c3a72
  [ 92,  32, 110], // 5  magenta  #5c206e
  [ 24,  88,  98], // 6  cyan     #185862
  [202, 208, 220], // 7  white    #cad0dc (help bar)
  [ 72,  79,  94], // 8  gray     #484f5e
  [204,  58,  58], // 9  bred     #cc3a3a
  [ 48, 158,  74], // 10 bgreen   #309e4a
  [245, 204,  66], // 11 byellow  #f5cc42 (cursor / CTA)
  [ 58, 116, 204], // 12 bblue    #3a74cc
  [178,  68, 198], // 13 bmagenta #b244c6
  [ 78, 214, 224], // 14 bcyan    #4ed6e0 (selected menu row)
  [245, 247, 255], // 15 bwhite   #f5f7ff
];

// Fixed xterm-256 indices (all in 16..255, never 0..15) for 256-color-only terminals.
const FG_256 = [233, 167, 71, 179, 68, 134, 74, 252, 102, 203, 78, 221, 75, 213, 81, 231];
const BG_256 = [233, 88, 22, 58, 18, 53, 23, 252, 239, 167, 71, 221, 68, 134, 80, 231];

const DEFAULT_FG = 7;
const DEFAULT_BG = 0;

function detectColorMode(env = process.env) {
  const override = (env.LCC_COLOR_MODE || '').toLowerCase();
  if (override === 'truecolor' || override === '256' || override === 'ansi') return override;
  const term = env.TERM || '';
  if (term === 'dumb' || term === 'linux') return 'ansi';
  if (env.TERM_PROGRAM === 'Apple_Terminal' && !/truecolor|24bit/i.test(env.COLORTERM || '')) return '256';
  return 'truecolor';
}

function ansiSgr(fg, bg, mode = 'truecolor', extra = '') {
  if (mode === 'ansi') {
    const f = fg < 8 ? 30 + fg : 90 + fg - 8;
    const b = bg < 8 ? 40 + bg : 100 + bg - 8;
    return `\x1b[0${extra};${f};${b}m`;
  }
  if (mode === '256') {
    return `\x1b[0${extra};38;5;${FG_256[fg]};48;5;${BG_256[bg]}m`;
  }
  const f = FG_PALETTE[fg];
  const b = BG_PALETTE[bg];
  return `\x1b[0${extra};38;2;${f[0]};${f[1]};${f[2]};48;2;${b[0]};${b[1]};${b[2]}m`;
}

function canvasSgr(mode = 'truecolor') {
  return ansiSgr(DEFAULT_FG, DEFAULT_BG, mode);
}

// Paint the entire terminal viewport with explicit opaque canvas spaces so
// margins outside a game's display block never show through on transparent terminals.
function fillCanvasAnsi(rows, cols, mode = 'truecolor') {
  const sgr = canvasSgr(mode);
  const r = Math.max(1, rows || 30);
  const c = Math.max(1, cols || 100);
  const blank = ' '.repeat(c);
  let out = `${sgr}\x1b[2J\x1b[?7l`;
  for (let y = 1; y <= r; y++) out += `\x1b[${y};1H${blank}`;
  out += `\x1b[?7h\x1b[H${sgr}`;
  return out;
}

// Stateful ANSI SGR stream translator for raw-output games (e.g. lib/term.ap /
// lemonade) so they share the same opaque palette instead of leaking terminal
// default colors or transparency. Handles escape sequences split across writes.
function createAnsiTranslator(mode = 'truecolor') {
  let fg = DEFAULT_FG;
  let bg = DEFAULT_BG;
  let bold = false;
  let reverse = false;
  let esc = null;

  function emitStyle() {
    let efg = (bold && fg < 8) ? fg + 8 : fg;
    let ebg = bg;
    if (reverse) { const t = efg; efg = ebg; ebg = t; }
    return ansiSgr(efg, ebg, mode, bold ? ';1' : '');
  }

  function translateSgr(params) {
    if (params.startsWith('?')) return `\x1b[${params}m`;
    const parts = params === '' ? [0] : params.split(';').map(p => (p === '' ? 0 : parseInt(p, 10)));
    // Preserve explicit 256-color / RGB sequences verbatim.
    if (parts.includes(38) || parts.includes(48)) return `\x1b[${params}m`;
    for (const n of parts) {
      if (Number.isNaN(n) || n === 0) { fg = DEFAULT_FG; bg = DEFAULT_BG; bold = false; reverse = false; }
      else if (n === 1) bold = true;
      else if (n === 22) bold = false;
      else if (n === 7) reverse = true;
      else if (n === 27) reverse = false;
      else if (n >= 30 && n <= 37) fg = n - 30;
      else if (n >= 90 && n <= 97) fg = n - 90 + 8;
      else if (n === 39) fg = DEFAULT_FG;
      else if (n >= 40 && n <= 47) bg = n - 40;
      else if (n >= 100 && n <= 107) bg = n - 100 + 8;
      else if (n === 49) bg = DEFAULT_BG;
    }
    return emitStyle();
  }

  return {
    reset() { fg = DEFAULT_FG; bg = DEFAULT_BG; bold = false; reverse = false; esc = null; },
    translate(str) {
      let out = '';
      for (const ch of str) {
        if (esc !== null) {
          esc += ch;
          if (esc.length === 2) {
            if (ch === '[') continue; // CSI
            out += esc;
            esc = null;
            continue;
          }
          if (esc.length > 64) { out += esc; esc = null; continue; }
          if (/[@-~]/.test(ch)) {
            if (ch === 'm') out += translateSgr(esc.slice(2, -1));
            else out += esc;
            esc = null;
          }
          continue;
        }
        if (ch === '\x1b') { esc = '\x1b'; continue; }
        out += ch;
      }
      return out;
    },
  };
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
function presentToAnsi(mem, addr, prev, opts = {}) {
  const mode = opts.colorMode || 'truecolor';
  const b = readBlock(mem, addr);
  let out = '';
  let curStyle = -1;
  for (let r = 0; r < b.rows; r++) {
    let pendingMove = true;
    for (let c = 0; c < b.cols; c++) {
      const w = mem[(b.base + r * b.cols + c) & 0xFFFF];
      const key = (b.top + r) * 1024 + b.left + c;
      if (prev.get(key) === w) { pendingMove = true; continue; }
      prev.set(key, w);
      if (pendingMove) { out += `\x1b[${b.top + r + 1};${b.left + c + 1}H`; pendingMove = false; }
      const attr = (w >> 8) & 0xFF;
      // attr === 0 means default colors: readable white on the opaque dark canvas.
      const style = attr === 0 ? (DEFAULT_FG | (DEFAULT_BG << 4)) : attr;
      if (style !== curStyle) {
        out += ansiSgr(style & 0xF, (style >> 4) & 0xF, mode);
        curStyle = style;
      }
      out += GLYPHS[w & 0xFF];
    }
  }
  if (out) out += canvasSgr(mode);
  return out;
}

module.exports = {
  TRAP_PRESENT, GLYPHS, FG_PALETTE, BG_PALETTE, FG_256, BG_256,
  sgrFor, detectColorMode, ansiSgr, canvasSgr, fillCanvasAnsi, createAnsiTranslator,
  readBlock, presentToVTerm, presentToAnsi, DisplayError,
  assemblerExtension: { mnemonics: { present: { trapVec: TRAP_PRESENT, operandShape: '[sr]' } } },
};
