'use strict';
// Every string a player sees from the versus server (not the game itself).
// Wording is owned by the copy author; code reads it from here only.

module.exports = {
  title: 'SCRAPCORE VERSUS',
  pitch: [
    'Everyone races through the same dungeon: same floors, robots and loot.',
    'First core to reach the surface wins. Otherwise the shallowest depth wins.',
  ],
  playersHeader: n => `Players (${n})`,
  ready: 'ready',
  notReady: 'not ready',
  racing: 'racing',
  you: '(you)',
  lobbyKeys: '[Enter] ready / not ready     [q] leave',
  waitingKeys: 'A race is running. You join the next one.     [q] leave',
  countdown: s => `Race starts in ${s}...`,
  needAll: 'The race starts when everyone is ready.',
  liveHeader: 'Race in progress',
  lastHeader: 'Last race',
  tooSmall: (c, r) => `Your window is ${c}x${r}. SCRAPCORE needs 100x31 - make it bigger.`,
  full: 'The server is full. Try again later.\r\n',
  badPassword: 'Wrong password.',
  bye: 'Thanks for playing SCRAPCORE.\r\n',
  hudLabel: 'RIVALS',
  hudNone: 'no rivals - solo race',
  // standing rows: r = { name, outcome, best, depth, core, kills, turns, place }
  standing: r => {
    switch (r.outcome) {
      case 'won': return `${r.name}: reached the surface in ${r.turns} turns, ${r.kills} kills`;
      case 'dead': return `${r.name}: destroyed at depth ${r.depth}, ${r.kills} kills`;
      case 'quit': return `${r.name}: gave up at depth ${r.depth}`;
      case 'left': return `${r.name}: disconnected at depth ${r.depth}`;
      case 'crashed': return `${r.name}: game crashed at depth ${r.depth}`;
      default: return `${r.name}: depth ${r.depth}, core ${r.core}, ${r.kills} kills`;
    }
  },
  // compact HUD cell for one rival
  hudCell: r => {
    switch (r.outcome) {
      case 'won': return `${r.name} SURFACED`;
      case 'dead': return `${r.name} X d${r.depth}`;
      case 'quit': case 'left': case 'crashed': return `${r.name} out d${r.depth}`;
      default: return `${r.name} d${r.depth} c${r.core}`;
    }
  },
};
