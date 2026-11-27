'use strict';
// Every string a player sees from the versus server (not the game itself).
// Wording is owned by the copy author; code reads it from here only.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const loc = d => (d === 0 ? 'Surface' : `Depth ${d}`);
const shortLoc = d => (d === 0 ? 'Surf' : `D${d}`);
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
  lobbyKeysRematch: '[Enter / Space] ready   [d] daily   [r] rematch   [Tab] board / chronicle   [q] leave',
  waitingKeys: 'Race in progress -- you will join the next one.   [Tab] board / chronicle   [q] leave',
  seedDaily: date => `Next race: daily seed for ${date} UTC (ranked on daily board; [d] for random).`,
  seedRandom: 'Next race: random seed (press [d] to switch the room to the daily seed).',
  seedRematch: seed => `Next race: rematch on seed ${hex(seed)} (not ranked on daily board; [r] for random).`,
  viewKeys: '[Tab] next view (lobby / board / chronicle)   [q] leave',
  boardTitle: (date, seed) => `DAILY BOARD -- ${date} UTC (seed ${hex(seed)})`,
  boardEmpty: '  No ranked runs yet today.',
  boardEntry: e => `${e.handle.padEnd(14)}${e.outcome === 'won' ? `Surface in ${clock(e.ms)}` : `${loc(e.best)}, ${clock(e.ms)}`}, ${plural(e.turns, 'turn')}`,
  guest: 'Guest session -- connect with an SSH key to keep a record and rank on the daily board.',
  noStore: 'This server does not save records or daily boards.',
  profile: p => (p
    ? `Your record: ${plural(p.races, 'race')}, ${plural(p.wins, 'win')}, best ${loc(p.bestDepth)}${p.fastestWinMs === null ? '' : `, fastest win ${clock(p.fastestWinMs)}`}`
    : 'Your record: no races yet.'),
  chronicleTitle: last => (last ? `LAST RACE -- ${last.daily ? `daily seed ${hex(last.seed)} (${last.daily.date} UTC)` : `seed ${hex(last.seed)}`}` : 'LAST RACE'),
  chronicleEmpty: 'No race has finished since the server started.',
  chronicleHead: (r, c = {}, width = 96) => {
    const kills = r.kills ?? c.kills ?? 0;
    const turns = r.turns ?? c.turns ?? 0;
    const salv = c.salvaged ?? 0, lost = c.lost ?? 0, rec = c.recycled ?? 0;
    const killer = c.cause ? ` by ${c.cause}` : '';
    const endWide = (
      r.outcome === 'won' ? 'reached Surface' :
      r.outcome === 'dead' ? `destroyed at ${loc(r.depth)}` :
      r.outcome === 'quit' ? `gave up at ${loc(r.depth)}` :
      r.outcome === 'left' ? `disconnected at ${loc(r.depth)}` :
      r.outcome === 'crashed' ? `crashed at ${loc(r.depth)}` :
      loc(r.depth)
    ) + killer;
    const endShort = (
      r.outcome === 'won' ? 'Surface' :
      r.outcome === 'dead' ? `dead ${shortLoc(r.depth)}` :
      r.outcome === 'quit' ? `quit ${shortLoc(r.depth)}` :
      r.outcome === 'left' ? `left ${shortLoc(r.depth)}` :
      r.outcome === 'crashed' ? `crashed ${shortLoc(r.depth)}` :
      shortLoc(r.depth)
    ) + killer;
    const wide = `${r.place}. ${r.name}: ${endWide} -- ${plural(kills, 'kill')}, ${plural(turns, 'turn')}; salv ${salv}, lost ${lost}, rec ${rec}`;
    if (wide.length <= width) return wide;
    const mid = `${r.place}. ${r.name}: ${endShort} -- ${plural(kills, 'kill')}, ${plural(turns, 'turn')}; salv ${salv}, lost ${lost}, rec ${rec}`;
    if (mid.length <= width) return mid;
    const tight = `${r.place}. ${r.name}: ${endShort} -- ${kills}k ${turns}t; salv ${salv}, lost ${lost}, rec ${rec}`;
    if (tight.length <= width) return tight;
    return `${r.place}. ${r.name}: ${endShort} ${kills}k/${turns}t s${salv}/l${lost}/r${rec}`;
  },
  splits: (splits, ms, width = 93) => {
    const reached = splits.filter(s => s.depth < 10);
    const hasSurf = reached.some(s => s.depth === 0);
    const end = clock(ms || 0);
    const wide = `Splits: ${reached.length ? reached.map(s => `${shortLoc(s.depth)} ${clock(s.ms)}`).join('  ') : 'none'}${hasSurf ? '' : `  (end ${end})`}`;
    if (wide.length <= width) return wide;
    const med = `Splits: ${reached.length ? reached.map(s => `${shortLoc(s.depth)} ${clock(s.ms)}`).join(' ') : 'none'}${hasSurf ? '' : ` (end ${end})`}`;
    if (med.length <= width) return med;
    const compact = `Splits: ${reached.length ? reached.map(s => `${s.depth === 0 ? 'Surf' : s.depth}@${clock(s.ms)}`).join(' ') : 'none'}${hasSurf ? '' : ` (end ${end})`}`;
    if (compact.length <= width) return compact;
    return `Spl: ${reached.length ? reached.map(s => `${s.depth === 0 ? 'S' : s.depth}@${clock(s.ms)}`).join(' ') : 'none'}${hasSurf ? '' : ` end ${end}`}`;
  },
  loadout: (parts, width = 93) => {
    if (!parts.length) return 'Loadout: none';
    const full = `Loadout: ${parts.join(', ')}`;
    if (full.length <= width) return full;
    const trim = (p, cap) => (p.length <= cap ? p : cap <= 1 ? p.slice(0, 1) : `${p.slice(0, cap - 1).trimEnd()}.`);
    for (let cap = Math.max(...parts.map(p => p.length)) - 1; cap >= 1; cap--) {
      const line = `Loadout: ${parts.map(p => trim(p, cap)).join(', ')}`;
      if (line.length <= width) return line;
    }
    return `Loadout: ${parts.map(p => p.slice(0, 1)).join(', ')}`;
  },
  countdown: s => `All ready -- starting in ${s}...`,
  needAll: 'Race starts when everyone in the lobby is ready.',
  liveHeader: 'Live standings',
  lastHeader: last => `Last race -- ${last.daily ? `daily seed ${hex(last.seed)} (${last.daily.date} UTC)` : `seed ${hex(last.seed)}`}`,
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
