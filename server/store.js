'use strict';
// Persistent versus records under --data-dir: player profiles (keyed by SSH
// public-key fingerprint) and one daily board per UTC date + game build + seed.
// Only fingerprints and display handles are stored, never keys or passwords.
// Every write is atomic (temp file + rename), so a crash leaves the old file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOARD_KEEP = 100;                    // ranked entries kept per daily board

// 'YYYY-MM-DD' for a time in UTC.
const utcDate = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
// The day's seed: the same 16-bit seed for everyone, all day, on every server.
const dailySeed = date => crypto.createHash('sha256').update(`scrapcore-daily:${date}`).digest().readUInt16BE(0);
// Identifies the game build, so different builds never share a board.
const buildId = build => crypto.createHash('sha256').update(Buffer.from(build.bytes)).digest('hex').slice(0, 12);
// OpenSSH-style fingerprint of a public key blob: SHA256:<base64, no padding>.
const fingerprint = keyData => 'SHA256:' + crypto.createHash('sha256').update(keyData).digest('base64').replace(/=+$/, '');

// Board order: surfaced first (fastest), then shallowest depth, then runs that
// ended in play (destroyed) before forfeits, disconnects and crashes, then time, turns.
const finish = o => (o === 'won' ? 0 : o === 'dead' ? 1 : 2);
function better(a, b) {
  const aw = a.outcome === 'won', bw = b.outcome === 'won';
  if (aw !== bw) return aw ? -1 : 1;
  return (aw ? 0 : a.best - b.best) || finish(a.outcome) - finish(b.outcome) || a.ms - b.ms || a.turns - b.turns;
}
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isBoard = v => isObject(v) && Array.isArray(v.entries) && v.entries.every(isObject);
const clone = v => JSON.parse(JSON.stringify(v));

class Store {
  constructor(dir) {
    this.dir = dir;
    this.profilesFile = path.join(dir, 'profiles.json');
    this.profiles = this.read(this.profilesFile, {}, v => isObject(v) && Object.values(v).every(isObject));
    this.boards = new Map();             // board key -> { date, build, seed, entries }
  }

  read(file, fallback, valid) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw e;
    }
    let data;
    try { data = JSON.parse(text); } catch (_) { data = undefined; }
    if (valid(data)) return data;
    // Keep a damaged file for the host to inspect instead of overwriting it.
    const aside = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, aside);
    console.error(`[versus] ${file} is damaged; moved it to ${aside}`);
    return fallback;
  }

  write(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      const fd = fs.openSync(tmp, 'wx', 0o600);
      try {
        fs.writeSync(fd, JSON.stringify(data, null, 1) + '\n');
        fs.fsyncSync(fd);           // the bytes are on disk before the rename makes them the file
      } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* never written */ }
      throw e;
    }
  }

  boardFile(date, build, seed) { return path.join(this.dir, 'daily', `${date}_${build}_${seed}.json`); }

  board(date, build, seed) {
    const file = this.boardFile(date, build, seed);
    if (!this.boards.has(file)) this.boards.set(file, this.read(file, { date, build, seed, entries: [] }, isBoard));
    return this.boards.get(file);
  }

  profile(fp) { return this.profiles[fp] || null; }

  // Record a finished race. runs: the race standings [{ fp, handle, place, outcome,
  // best, ms, turns, kills }]; only racers with a verified key (fp) are recorded.
  // A win is first place on the Surface. daily: { date, build, seed } or null.
  // One key racing in two seats counts once, with its better-placed run.
  // Both files are written before memory changes, so a failed write changes nothing.
  recordRace(runs, daily) {
    const ranked = [];
    for (const r of [...runs].sort((a, b) => a.place - b.place)) if (r.fp && !ranked.some(o => o.fp === r.fp)) ranked.push(r);
    if (!ranked.length) return;
    const profiles = clone(this.profiles);
    for (const r of ranked) {
      const p = profiles[r.fp] || (profiles[r.fp] = { handle: r.handle, races: 0, wins: 0, bestDepth: null, fastestWinMs: null });
      const won = r.outcome === 'won' && r.place === 1;
      p.handle = r.handle;
      p.races++;
      if (won) p.wins++;
      if (p.bestDepth === null || r.best < p.bestDepth) p.bestDepth = r.best;
      if (won && (p.fastestWinMs === null || r.ms < p.fastestWinMs)) p.fastestWinMs = r.ms;
    }
    const b = daily ? clone(this.board(daily.date, daily.build, daily.seed)) : null;
    if (b) this.rankDaily(b, ranked);
    if (b) this.write(this.boardFile(daily.date, daily.build, daily.seed), b);
    this.write(this.profilesFile, profiles);
    this.profiles = profiles;
    if (b) this.boards.set(this.boardFile(daily.date, daily.build, daily.seed), b);
  }

  rankDaily(b, ranked) {
    for (const r of ranked) {
      const entry = { fp: r.fp, handle: r.handle, outcome: r.outcome, best: r.best, ms: r.ms, turns: r.turns, kills: r.kills };
      const i = b.entries.findIndex(e => e.fp === r.fp);
      if (i < 0) b.entries.push(entry);
      else if (better(entry, b.entries[i]) < 0) b.entries[i] = entry;
      else b.entries[i].handle = r.handle;
    }
    b.entries.sort(better);
    b.entries.length = Math.min(b.entries.length, BOARD_KEEP);
  }
}

module.exports = { Store, utcDate, dailySeed, buildId, fingerprint, better };
