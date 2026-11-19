'use strict';
// Minimal virtual terminal: enough of VT100/ANSI to capture what an LCC+ game
// draws. Tracks a character grid, cursor, cursor visibility, and per-cell SGR
// color codes (so tests can assert on colors if they want to).

class VTerm {
  constructor(rows = 30, cols = 100) {
    this.rows = rows;
    this.cols = cols;
    this.bells = 0;
    this.cursorVisible = true;
    this.sgr = '';            // current SGR attribute string, e.g. "31;1"
    this.clearAll();
    this._esc = null;         // pending escape sequence buffer
    this.dirty = false;
  }

  clearAll() {
    this.grid = Array.from({ length: this.rows }, () => new Array(this.cols).fill(' '));
    this.attr = Array.from({ length: this.rows }, () => new Array(this.cols).fill(''));
    this.row = 0;
    this.col = 0;
    this.dirty = true;
  }

  home() { this.row = 0; this.col = 0; }

  _scroll() {
    this.grid.shift();
    this.attr.shift();
    this.grid.push(new Array(this.cols).fill(' '));
    this.attr.push(new Array(this.cols).fill(''));
    this.row = this.rows - 1;
  }

  _newline() {
    this.row++;
    if (this.row >= this.rows) this._scroll();
  }

  _put(ch) {
    if (this.col >= this.cols) {   // autowrap
      this.col = 0;
      this._newline();
    }
    this.grid[this.row][this.col] = ch;
    this.attr[this.row][this.col] = this.sgr;
    this.col++;
    this.dirty = true;
  }

  write(str) {
    for (const ch of str) this._char(ch);
  }

  _char(ch) {
    if (this._esc !== null) return this._escChar(ch);
    switch (ch) {
      case '\x1b': this._esc = ''; return;
      case '\n': this.col = 0; this._newline(); return;   // onlcr: \n => CR LF
      case '\r': this.col = 0; return;
      case '\b': if (this.col > 0) this.col--; return;
      case '\t': this.col = Math.min(this.cols - 1, (Math.floor(this.col / 8) + 1) * 8); return;
      case '\x07': this.bells++; return;
      default:
        if (ch < ' ') return;      // other control chars: ignore
        this._put(ch);
    }
  }

  _escChar(ch) {
    this._esc += ch;
    const s = this._esc;
    if (s === '[' || s === '(' || s === ')') return;
    if (s[0] !== '[') {          // two-char escapes (ESC c = reset, ESC 7/8 ...)
      if (s === 'c') this.clearAll();
      this._esc = null;
      return;
    }
    if (!/[@-~]/.test(ch) || s.length === 1) return; // CSI still collecting params
    this._esc = null;
    this._csi(s.slice(1, -1), ch);
  }

  _csi(params, final) {
    const priv = params.startsWith('?');
    const nums = (priv ? params.slice(1) : params).split(';').map(p => (p === '' ? NaN : parseInt(p, 10)));
    const n = (i, d) => (Number.isNaN(nums[i]) || nums[i] === undefined ? d : nums[i]);
    const clampR = r => Math.max(0, Math.min(this.rows - 1, r));
    const clampC = c => Math.max(0, Math.min(this.cols - 1, c));
    switch (final) {
      case 'H': case 'f': this.row = clampR(n(0, 1) - 1); this.col = clampC(n(1, 1) - 1); break;
      case 'A': this.row = clampR(this.row - n(0, 1)); break;
      case 'B': this.row = clampR(this.row + n(0, 1)); break;
      case 'C': this.col = clampC(this.col + n(0, 1)); break;
      case 'D': this.col = clampC(this.col - n(0, 1)); break;
      case 'G': this.col = clampC(n(0, 1) - 1); break;
      case 'J': {
        const mode = n(0, 0);
        if (mode === 2 || mode === 3) { const r = this.row, c = this.col; this.clearAll(); this.row = r; this.col = c; }
        else if (mode === 0) { this._eraseLine(this.row, this.col, this.cols); for (let r = this.row + 1; r < this.rows; r++) this._eraseLine(r, 0, this.cols); }
        else if (mode === 1) { for (let r = 0; r < this.row; r++) this._eraseLine(r, 0, this.cols); this._eraseLine(this.row, 0, this.col + 1); }
        break;
      }
      case 'K': {
        const mode = n(0, 0);
        if (mode === 0) this._eraseLine(this.row, this.col, this.cols);
        else if (mode === 1) this._eraseLine(this.row, 0, this.col + 1);
        else this._eraseLine(this.row, 0, this.cols);
        break;
      }
      case 'm': {
        const p = priv ? '' : params;
        this.sgr = (p === '' || p === '0') ? '' : p;
        break;
      }
      case 'h': case 'l':
        if (priv && n(0) === 25) this.cursorVisible = final === 'h';
        break;
      default: break; // ignore everything else
    }
  }

  _eraseLine(r, from, to) {
    for (let c = from; c < to; c++) { this.grid[r][c] = ' '; this.attr[r][c] = ''; }
    this.dirty = true;
  }

  // Plain text of the screen, trailing spaces / trailing blank rows trimmed.
  text() {
    const lines = this.grid.map(r => r.join('').replace(/\s+$/, ''));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  // Color map: same shape as text; each cell is a letter for its SGR foreground
  // (or background when bg=true): k r g y b m c w, uppercase = bright, '.' default.
  colorText(bg = false) {
    const code = a => {
      if (!a) return '.';
      const nums = a.split(';').map(Number);
      const m = bg
        ? nums.find(x => (x >= 40 && x <= 47) || (x >= 100 && x <= 107))
        : nums.find(x => (x >= 30 && x <= 37) || (x >= 90 && x <= 97));
      if (m === undefined) return bg ? '.' : '*';
      const base = bg ? (m >= 100 ? m - 100 + 8 : m - 40) : (m >= 90 ? m - 90 + 8 : m - 30);
      return 'krgybmcwKRGYBMCW'[base];
    };
    const lines = this.attr.map((r, ri) => r.map((a, ci) => (this.grid[ri][ci] === ' ' && !a ? ' ' : code(a))).join('').replace(/\s+$/, ''));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }
}

module.exports = VTerm;
