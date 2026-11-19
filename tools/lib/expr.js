'use strict';
// Integer constant expressions for .define and operands.
// Supports: decimal, 0x hex, 0b binary, 'c' char literals ('\n' '\t' '\\' '\''),
// UPPER_CASE defines, unary - ~ +, and * / % + - << >> & ^ | with C precedence.
// Results must fit in 16 bits (-32768..65535).

class ExprError extends Error {}

const ESC = { n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34 };

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    let m;
    const rest = src.slice(i);
    if ((m = rest.match(/^0x[0-9a-fA-F]+/))) { toks.push({ t: 'num', v: parseInt(m[0], 16) }); i += m[0].length; continue; }
    if ((m = rest.match(/^0b[01]+/))) { toks.push({ t: 'num', v: parseInt(m[0].slice(2), 2) }); i += m[0].length; continue; }
    if ((m = rest.match(/^\d+/))) { toks.push({ t: 'num', v: parseInt(m[0], 10) }); i += m[0].length; continue; }
    if ((m = rest.match(/^'(\\.|[^'\\])'/))) {
      const body = m[1];
      const v = body.length === 2 ? ESC[body[1]] : body.charCodeAt(0);
      if (v === undefined) throw new ExprError(`unknown escape in char literal ${m[0]}`);
      toks.push({ t: 'num', v }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^[A-Za-z_]\w*/))) { toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    if ((m = rest.match(/^(<<|>>|[-+*/%&|^~()])/))) { toks.push({ t: 'op', v: m[0] }); i += m[0].length; continue; }
    throw new ExprError(`unexpected character '${ch}' in expression "${src}"`);
  }
  return toks;
}

const BIN = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

function evalExpr(src, defines) {
  const toks = tokenize(String(src));
  let p = 0;
  const peek = () => toks[p];
  function primary() {
    const t = toks[p++];
    if (!t) throw new ExprError(`unexpected end of expression "${src}"`);
    if (t.t === 'num') return t.v;
    if (t.t === 'id') {
      if (!defines.has(t.v)) throw new ExprError(`unknown constant ${t.v} in "${src}" (constants must be .define-d before use)`);
      return defines.get(t.v);
    }
    if (t.v === '(') { const v = expr(0); const c = toks[p++]; if (!c || c.v !== ')') throw new ExprError(`missing ) in "${src}"`); return v; }
    if (t.v === '-') return -primary();
    if (t.v === '+') return primary();
    if (t.v === '~') return ~primary();
    throw new ExprError(`unexpected '${t.v}' in "${src}"`);
  }
  function expr(minPrec) {
    let lhs = primary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !(t.v in BIN) || BIN[t.v] <= minPrec - 1 || BIN[t.v] < minPrec) break;
      p++;
      const rhs = expr(BIN[t.v] + 1);
      switch (t.v) {
        case '|': lhs |= rhs; break;
        case '^': lhs ^= rhs; break;
        case '&': lhs &= rhs; break;
        case '<<': lhs <<= rhs; break;
        case '>>': lhs >>= rhs; break;
        case '+': lhs += rhs; break;
        case '-': lhs -= rhs; break;
        case '*': lhs *= rhs; break;
        case '/': if (rhs === 0) throw new ExprError(`division by zero in "${src}"`); lhs = Math.trunc(lhs / rhs); break;
        case '%': if (rhs === 0) throw new ExprError(`division by zero in "${src}"`); lhs %= rhs; break;
      }
    }
    return lhs;
  }
  const v = expr(0);
  if (p !== toks.length) throw new ExprError(`unexpected '${toks[p].v}' in "${src}"`);
  if (v < -32768 || v > 65535) throw new ExprError(`value ${v} of "${src}" does not fit in 16 bits`);
  return v;
}

module.exports = { evalExpr, ExprError };
