'use strict';
// Every string a player sees from the versus server (not the game itself).
// Wording is owned by the copy author; code reads it from here only.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const loc = d => (d === 0 ? 'Surface' : `Depth ${d}`);
const clock = ms => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const hex = n => `#${n.toString(16).toUpperCase().padStart(4, '0')}`;

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
  lobbyKeys: '[Enter / Space] ready   [d] daily seed   [Tab] board / chronicle   [q] leave',
  waitingKeys: 'Race in progress -- you will join the next one.   [Tab] board / chronicle   [q] leave',
  seedDaily: date => `Next race: the daily seed for ${date} (ranked on the daily board).`,
  seedRandom: 'Next race: a random seed. Press [d] to race the daily seed.',
  viewKeys: '[Tab] next view   [q] leave',
  boardTitle: (date, seed) => `DAILY BOARD -- ${date} UTC, seed ${hex(seed)}`,
  boardEmpty: '  No ranked runs yet today.',
  boardEntry: e => `${e.handle.padEnd(13)}${e.outcome === 'won' ? `Surface in ${clock(e.ms)}` : `${loc(e.best)}, ${clock(e.ms)}`}, ${plural(e.turns, 'turn')}`,
  guest: 'Guest: connect with an SSH key to be ranked and keep a profile.',
  noStore: 'This server does not save results.',
  profile: p => (p
    ? `Your record: ${plural(p.races, 'race')}, ${plural(p.wins, 'win')}, best ${loc(p.bestDepth)}${p.fastestWinMs === null ? '' : `, fastest win ${clock(p.fastestWinMs)}`}`
    : 'Your record: no races yet.'),
  chronicleTitle: last => (last ? `LAST RACE -- seed ${hex(last.seed)}${last.daily ? ` (daily ${last.daily.date})` : ''}` : 'LAST RACE'),
  chronicleEmpty: 'No race has finished since the server started.',
  splits: (splits, ms) => {
    const out = splits.filter(s => s.depth < 10).map(s => `${s.depth === 0 ? 'Surf' : `D${s.depth}`} ${clock(s.ms)}`);
    return `Splits: ${out.length ? out.join('  ') : 'none'}   (ended ${clock(ms || 0)})`;
  },
  loadout: parts => `Loadout: ${parts.length ? parts.join(', ') : 'empty'}`,
  runStats: c => `-- ${c.cause ? `killed by ${c.cause}; ` : ''}salvaged ${c.salvaged}, lost ${c.lost}, recycled ${c.recycled}`,
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
