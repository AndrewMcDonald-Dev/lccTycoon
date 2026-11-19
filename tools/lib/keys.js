'use strict';
// Key-script parser. A key script is a whitespace-separated list of tokens;
// each token is ONE frame's worth of input (a "batch").
//
//   d          frame with key 'd'
//   wasd       frame with keys w,a,s,d (all queued in the same frame)
//   _          one frame with no input            _5   five empty frames
//   d*4        four frames, each with 'd'         _*3 is the same as _3
//   42<enter>  frame with '4','2','\n'  (for din/sin/ain-based programs)
//
// Named keys (usable anywhere inside a token):
//   <enter> <space> <tab> <esc> <bs> <up> <down> <left> <right>
//   <lt> (<)  <star> (*)  <us> (_)  <hash> (#)  <NN> (decimal ASCII code, e.g. <65>)

const NAMED = {
  enter: '\n', space: ' ', tab: '\t', esc: '\x1b', bs: '\x7f',
  up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D',
  lt: '<', star: '*', us: '_', hash: '#',
};

function decodeToken(tok) {
  let out = '';
  for (let i = 0; i < tok.length; i++) {
    if (tok[i] === '<') {
      const j = tok.indexOf('>', i);
      if (j === -1) throw new Error(`Unclosed <...> in key token "${tok}"`);
      const name = tok.slice(i + 1, j).toLowerCase();
      if (/^\d+$/.test(name)) out += String.fromCharCode(parseInt(name, 10));
      else if (Object.prototype.hasOwnProperty.call(NAMED, name)) out += NAMED[name];
      else throw new Error(`Unknown key name <${name}> in "${tok}". Known: ${Object.keys(NAMED).join(', ')}, or <NN> for ASCII code`);
      i = j;
    } else {
      out += tok[i];
    }
  }
  return out;
}

// Returns an array of strings, one per frame ('' = no input that frame).
function parseKeys(script) {
  const frames = [];
  if (!script) return frames;
  for (const raw of script.trim().split(/\s+/)) {
    if (!raw) continue;
    let tok = raw;
    let reps = 1;
    const star = tok.match(/^(.*)\*(\d+)$/);
    if (star) { tok = star[1]; reps = parseInt(star[2], 10); }
    const wait = tok.match(/^_(\d*)$/);
    if (wait) {
      const n = (wait[1] === '' ? 1 : parseInt(wait[1], 10)) * reps;
      for (let i = 0; i < n; i++) frames.push('');
      continue;
    }
    const keys = decodeToken(tok);
    for (let i = 0; i < reps; i++) frames.push(keys);
  }
  return frames;
}

module.exports = { parseKeys, decodeToken, NAMED };
