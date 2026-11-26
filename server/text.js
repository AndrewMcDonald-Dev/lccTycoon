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
  lobbyKeys: '[Enter / Space] ready   [d] daily / random   [Tab] board / chronicle   [q] leave',
  waitingKeys: 'Race in progress -- you will join the next one.   [Tab] board / chronicle   [q] leave',
  seedDaily: date => `Next race: daily seed for ${date} UTC (ranked on daily board; [d] for random).`,
  seedRandom: 'Next race: random seed (press [d] to switch the room to the daily seed).',
  viewKeys: '[Tab] next view (lobby / board / chronicle)   [q] leave',
  boardTitle: (date, seed) => `DAILY BOARD -- ${date} UTC (seed ${hex(seed)})`,
  boardEmpty: '  No ranked runs yet today.',
  boardEntry: e => `${e.handle.padEnd(14)}${e.outcome === 'won' ? `Surface in ${clock(e.ms)}` : `${loc(e.best)}, ${clock(e.ms)}`}, ${plural(e.turns, 'turn')}`,
  guest: 'Guest session -- connect with an SSH key to keep a record and rank on the daily board.',
  noStore: 'This server does not save records or daily boards.',
  profile: p => (p
    ? `Your record: ${plural(p.races, 'race')}, ${plural(p.wins, 'win')}, best ${loc(p.bestDepth)}${p.fastestWinMs === null ? '' : `, fastest win ${clock(p.fastestWinMs)}`}`
    : 'Your record: no races yet.'),
  chronicleTitle: last => (last ? `LAST RACE -- ${last.daily ? `daily seed ${hex(last.seed)} (${last.daily.date} UTC)` : `random seed ${hex(last.seed)}`}` : 'LAST RACE'),
  chronicleEmpty: 'No race has finished since the server started.',
  splits: (splits, ms) => {
    const out = splits.filter(s => s.depth < 10).map(s => `${s.depth === 0 ? 'Surf' : `D${s.depth}`} ${clock(s.ms)}`);
    const hasSurf = splits.some(s => s.depth === 0);
    const tail = hasSurf ? '' : `  (end ${clock(ms || 0)})`;
    const wide = `Splits: ${out.length ? out.join('  ') : 'none'}${tail}`;
    if (wide.length <= 93) return wide;
    return `Splits: ${out.join(' ')}${hasSurf ? '' : ` (end ${clock(ms || 0)})`}`;
  },
  loadout: parts => `Loadout: ${parts.length ? parts.join(', ') : 'none'}`,
  runStats: c => `-- ${c.cause ? `by ${c.cause}; ` : ''}salv ${c.salvaged}, lost ${c.lost}, rec ${c.recycled}`,
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
