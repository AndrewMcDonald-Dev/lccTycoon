'use strict';
// Every string a player sees from the versus server (not the game itself).
// Wording is owned by the copy author; code reads it from here only.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const loc = d => (d === 0 ? 'Surface' : `Depth ${d}`);

module.exports = {
  title: 'SCRAPCORE -- VERSUS',
  pitch: [
    'Same seed: identical starting parts, floors, robots, and loot for all.',
    'Climb from Depth 10 to the Surface. First out wins, else shallowest depth.',
  ],
  playersHeader: n => `Players (${n})`,
  ready: 'READY',
  notReady: 'not ready',
  racing: 'RACING',
  you: '(you)',
  lobbyKeys: '[Enter / Space] toggle ready   [q / Ctrl-C] leave',
  waitingKeys: 'Race in progress -- you will join the next one.   [q] leave',
  countdown: s => `All ready -- starting in ${s}...`,
  needAll: 'Race starts when everyone in the lobby is ready.',
  liveHeader: 'Live standings',
  lastHeader: 'Last race',
  tooSmall: (c, r) => `Window is ${c}x${r} -- resize to at least 100x31 to play.`,
  full: 'This SCRAPCORE versus server is full. Try again later.\r\n',
  badPassword: 'Incorrect password.',
  bye: 'Thanks for racing SCRAPCORE.\r\n',
  hudLabel: 'RIVALS',
  hudNone: 'solo run -- no other racers',
  // standing rows: r = { name, outcome, best, depth, core, kills, turns, place }
  standing: r => {
    switch (r.outcome) {
      case 'won':
        return `${r.name}: reached Surface in ${plural(r.turns, 'turn')}, ${plural(r.kills, 'kill')}`;
      case 'dead':
        return `${r.name}: destroyed at ${loc(r.depth)} (${plural(r.kills, 'kill')}, ${plural(r.turns, 'turn')})`;
      case 'quit':
        return `${r.name}: gave up at ${loc(r.depth)} (${plural(r.kills, 'kill')}, ${plural(r.turns, 'turn')})`;
      case 'left':
        return `${r.name}: disconnected at ${loc(r.depth)}`;
      case 'crashed':
        return `${r.name}: crashed at ${loc(r.depth)}`;
      default:
        return `${r.name}: ${loc(r.depth)}, Core ${r.core}, ${plural(r.kills, 'kill')}`;
    }
  },
  // compact HUD cell for one rival
  hudCell: r => {
    switch (r.outcome) {
      case 'won': return `${r.name} SURFACED`;
      case 'dead': return `${r.name} X D${r.depth}`;
      case 'quit': case 'left': case 'crashed': return `${r.name} OUT D${r.depth}`;
      default: return `${r.name} D${r.depth} C${r.core}`;
    }
  },
};
