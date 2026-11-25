'use strict';
// The versus room: one lobby, one race at a time, any number of racers.
// A "conn" is anything with { name, rows, cols, colorMode, write(str), close() };
// server.js adapts SSH channels to it and tests use plain objects.

const crypto = require('crypto');
const path = require('path');
const display = require(path.join(__dirname, '..', 'tools/lib/display'));
const { RaceGame, GAME } = require('./vm');
const T = require('./text');

const NEED_ROWS = 31;
const NEED_COLS = 100;
const HUD_ROW = 31;                   // 1-based terminal row under the 30-row game
const MAX_ROWS = 200;                 // guests pick their terminal size; bound what we draw
const MAX_COLS = 500;
const clamp = (v, lo, hi, dflt) => (Number.isInteger(v) && v >= lo ? Math.min(v, hi) : dflt);
const bigEnough = c => c.rows >= NEED_ROWS && c.cols >= NEED_COLS;
// Shortened names keep their last character so robot, robot2, robot3 stay apart.
const shorten = (name, n) => (name.length <= n ? name : name.slice(0, n - 1) + name.slice(-1));

class Room {
  // opts: { build, countdownMs = 3000, endScreenMs = 20000, pollMs = 250, maxPlayers = 8, seed() }
  constructor(opts) {
    this.build = opts.build;
    this.countdownMs = opts.countdownMs === undefined ? 3000 : opts.countdownMs;
    this.pollMs = opts.pollMs || 250;
    this.endScreenMs = opts.endScreenMs === undefined ? 20000 : opts.endScreenMs;
    this.maxPlayers = opts.maxPlayers || 8;
    this.nextSeed = opts.seed || (() => crypto.randomInt(0, 0x10000));
    this.members = [];                // { conn, name, ready, game, result }
    this.phase = 'lobby';             // lobby | countdown | race
    this.race = null;                 // { seed, racers: [member], startedAt }
    this.lastResults = null;
    this.countdownTimer = null;
    this.countdownEnds = 0;
    this.redrawTimer = null;
    this.poller = setInterval(() => this.tick(), this.pollMs);
    this.poller.unref();
  }

  close() {
    clearInterval(this.poller);
    if (this.redrawTimer) clearTimeout(this.redrawTimer);
    this.cancelCountdown();
    for (const m of [...this.members]) this.leave(m);
  }

  isFull() { return this.members.length >= this.maxPlayers; }

  uniqueName(raw) {
    let base = String(raw || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'robot';
    let name = base;
    for (let i = 2; this.members.some(m => m.name.toLowerCase() === name.toLowerCase()); i++) name = `${base.slice(0, 10)}${i}`;
    return name;
  }

  join(conn) {
    conn.rows = clamp(conn.rows, 1, MAX_ROWS, 24);
    conn.cols = clamp(conn.cols, 1, MAX_COLS, 80);
    const m = { conn, name: this.uniqueName(conn.name), ready: false, game: null, result: null, lobbyText: null };
    this.members.push(m);
    conn.write('\x1b[?1049h\x1b[?25l');
    if (this.phase === 'countdown') this.cancelCountdown();
    this.requestLobbies();
    return m;
  }

  leave(m) {
    if (!this.members.includes(m)) return;
    console.log(`[versus] ${m.name} left (${this.members.length - 1} online)`);
    this.stopGame(m, 'left');
    this.members = this.members.filter(x => x !== m);
    try { m.conn.write('\x1b[0m\x1b[?25h\x1b[?1049l'); m.conn.close(); } catch (_) { /* gone */ }
    this.maybeEndRace();
    this.maybeCountdown();
    this.requestLobbies();
  }

  resize(m, rows, cols) {
    rows = clamp(rows, 1, MAX_ROWS, m.conn.rows);
    cols = clamp(cols, 1, MAX_COLS, m.conn.cols);
    if (rows === m.conn.rows && cols === m.conn.cols) return;
    m.conn.rows = rows;
    m.conn.cols = cols;
    if (m.game) { m.game.repaint(rows, cols); this.drawHud(m); return; }
    if (m.ready && !bigEnough(m.conn)) { m.ready = false; this.cancelCountdown(); }
    this.requestLobbies();          // lobbyText includes the size, so this member redraws
  }

  input(m, data) {
    if (!this.members.includes(m)) return;
    const s = data.toString('utf8');
    if (m.game) {
      if (s.includes('\x03')) { this.forfeit(m); return; }   // Ctrl-C: give up, back to the lobby
      m.game.pushKeys(s);
      return;
    }
    if (/[qQ\x03\x04]/.test(s)) { this.leave(m); return; }
    // One toggle per chunk: Enter may arrive as \r\n, and a pasted burst is one press.
    if (/[\r\n ]/.test(s) && this.phase !== 'race' && (m.ready || bigEnough(m.conn))) {
      m.ready = !m.ready;
      if (!m.ready) this.cancelCountdown();
      this.maybeCountdown();
      this.requestLobbies();
    }
  }

  // ---- countdown / race -----------------------------------------------------
  maybeCountdown() {
    if (this.phase !== 'lobby' || !this.members.length || !this.members.every(m => m.ready)) return;
    this.phase = 'countdown';
    this.countdownEnds = Date.now() + this.countdownMs;
    const step = () => {
      if (this.phase !== 'countdown') return;
      if (Date.now() >= this.countdownEnds) { this.startRace(); return; }
      this.requestLobbies();
      this.countdownTimer = setTimeout(step, Math.min(1000, Math.max(0, this.countdownEnds - Date.now())));
    };
    step();
  }

  cancelCountdown() {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    if (this.phase === 'countdown') this.phase = 'lobby';
  }

  startRace() {
    this.cancelCountdown();
    const racers = this.members.filter(m => m.ready);
    if (!racers.length) return;
    this.phase = 'race';
    this.race = { seed: this.nextSeed(), racers, startedAt: Date.now() };
    for (const m of racers) {
      m.ready = false;
      m.result = null;
      m.game = new RaceGame({
        build: this.build, seed: this.race.seed, race: true,
        colorMode: m.conn.colorMode, rows: m.conn.rows, cols: m.conn.cols,
        onOutput: s => m.conn.write(s),
        onExit: (reason, detail) => this.gameExited(m, reason, detail),
      });
      m.game.start();
    }
    this.requestLobbies();
  }

  // Record the racer's result (if not yet) and stop their game. A finish the VM
  // saw (destroyed / surfaced) wins over `fallback`, whatever happened after it.
  stopGame(m, fallback) {
    this.recordResult(m, fallback);
    if (!m.game) return;
    m.game.stop();
    m.game = null;
  }

  recordResult(m, fallback) {
    if (m.result || !m.game) return;
    const g = m.game, s = g.stats();
    if (g.endState === null && (s.state === GAME.WON || s.state === GAME.DEAD)) g.markEnd();   // finished, not yet slept
    if (g.endState === GAME.WON || g.endState === GAME.DEAD) {
      m.result = { outcome: g.endState === GAME.WON ? 'won' : 'dead', ...g.endStats, at: g.endAt };
    } else if (fallback) {
      m.result = { outcome: fallback, depth: s.depth, best: s.best, core: s.core, kills: s.kills, turns: s.turns, at: performance.now() };
    }
  }

  forfeit(m) {
    this.stopGame(m, 'quit');
    this.backToLobby(m);
  }

  gameExited(m, reason, detail) {
    if (!m.game) return;
    if (reason === 'error') console.error(`[versus] ${m.name}: game error: ${detail}`);
    this.stopGame(m, reason === 'error' ? 'crashed' : 'quit');
    this.backToLobby(m);
  }

  backToLobby(m) {
    m.lobbyText = null;
    this.maybeEndRace();
    this.requestLobbies();
  }

  // The race is over once every racer has a result. Finished racers see their
  // end screen until they press a key, or (once everyone has a result) until
  // endScreenMs after their own finish, so one idle player cannot hold up the next race.
  maybeEndRace() {
    if (this.phase !== 'race') return;
    if (this.race.racers.some(m => !m.result)) return;
    const now = performance.now();
    for (const m of this.race.racers) {
      if (m.game && now - m.result.at >= this.endScreenMs) { this.stopGame(m); m.lobbyText = null; }
    }
    if (this.race.racers.some(m => m.game)) return;
    this.lastResults = this.standings();
    this.race = null;
    this.phase = 'lobby';
    for (const m of this.members) m.result = null;
    this.maybeCountdown();
    this.requestLobbies();
  }

  // Poll: record finishes the VMs saw, and refresh rival lines and lobbies.
  tick() {
    if (this.phase !== 'race') return;
    for (const m of this.race.racers) this.recordResult(m);
    this.maybeEndRace();
    if (this.phase !== 'race') return;
    for (const m of this.race.racers) if (m.game) this.drawHud(m);
    this.drawLobbies();
  }

  // Standings: finished-on-the-surface first (earliest), then shallowest depth reached,
  // then still racing, then kills, then fewer turns.
  standings() {
    if (!this.race) return [];
    const rows = this.race.racers.map(m => {
      const s = m.result || (m.game ? m.game.stats() : { depth: 0, best: 0, core: 0, kills: 0, turns: 0 });
      return { name: m.name, outcome: m.result ? m.result.outcome : 'racing', depth: s.depth, best: s.best, core: s.core, kills: s.kills, turns: s.turns, at: m.result ? m.result.at : Infinity };
    });
    rows.sort((a, b) => {
      const aw = a.outcome === 'won', bw = b.outcome === 'won';
      if (aw !== bw) return aw ? -1 : 1;
      if (aw) return a.at - b.at;
      const ar = a.outcome === 'racing' ? 0 : 1, br = b.outcome === 'racing' ? 0 : 1;   // still racing beats out, at equal depth
      return a.best - b.best || ar - br || b.kills - a.kills || a.turns - b.turns;
    });
    rows.forEach((r, i) => { r.place = i + 1; });
    return rows;
  }

  // ---- drawing ----------------------------------------------------------------
  // Lobby redraws are coalesced (bursts of joins / ready toggles draw once) and
  // skipped when a member's lobby text has not changed.
  requestLobbies() {
    if (this.redrawTimer) return;
    this.redrawTimer = setTimeout(() => { this.redrawTimer = null; this.drawLobbies(); }, 30);
  }

  drawLobbies() { for (const m of this.members) if (!m.game) this.drawLobby(m); }

  drawLobby(m) {
    const { rows, cols, colorMode } = m.conn;
    const lines = [T.title, ''];
    for (const p of T.pitch) lines.push(p);
    lines.push('');
    if (rows < NEED_ROWS || cols < NEED_COLS) lines.push(T.tooSmall(cols, rows), '');
    const inRace = this.phase === 'race' && this.race;
    if (inRace) {
      lines.push(T.liveHeader);
      for (const r of this.standings()) lines.push(`  ${r.place}. ${T.standing(r)}`);
      lines.push('');
    }
    lines.push(T.playersHeader(this.members.length));
    for (const p of this.members) {
      const tag = p.game ? T.racing : (p.ready ? T.ready : T.notReady);
      lines.push(`  ${p === m ? '>' : ' '} ${p.name.padEnd(13)}${tag}${p === m ? ' ' + T.you : ''}`);
    }
    lines.push('');
    if (this.phase === 'countdown') lines.push(T.countdown(Math.max(1, Math.ceil((this.countdownEnds - Date.now()) / 1000))));
    else if (!inRace) lines.push(T.needAll);
    if (this.lastResults && !inRace) {
      lines.push('', T.lastHeader);
      for (const r of this.lastResults) lines.push(`  ${r.place}. ${T.standing(r)}`);
    }
    lines.push('', inRace && !m.game ? T.waitingKeys : T.lobbyKeys);
    const key = `${rows}x${cols}\n${lines.join('\n')}`;
    if (key === m.lobbyText) return;
    m.lobbyText = key;
    const sgr = display.canvasSgr(colorMode);
    const accent = display.ansiSgr(11, 0, colorMode, ';1');
    let out = '\x1b[?25l' + display.fillCanvasAnsi(rows, cols, colorMode);
    lines.slice(0, Math.max(1, rows - 1)).forEach((line, i) => {
      out += `\x1b[${i + 2};3H${i === 0 ? accent : sgr}${line.slice(0, Math.max(0, cols - 4))}`;
    });
    m.conn.write(out + sgr);
  }

  // Rival line, at most `width` chars: every rival keeps its full status; the
  // space left after statuses and separators is shared out as name width, and
  // names that shorten to the same label get their racer number instead of
  // their last letter (rt, r2, ...), so seven rivals fit in 100 columns.
  hudText(m, width = NEED_COLS) {
    const rivals = this.standings().filter(r => r.name !== m.name);
    const head = ` ${T.hudLabel}  `;
    if (!rivals.length) return (head + T.hudNone).slice(0, width);
    const sep = ' | ';
    const tails = rivals.map(r => T.hudCell({ ...r, name: '' }));
    const room = width - head.length - sep.length * (rivals.length - 1) - tails.reduce((n, t) => n + t.length, 0);
    const w = Math.max(1, Math.floor(room / rivals.length));
    const labels = rivals.map(r => shorten(r.name, w));
    const order = this.race ? this.race.racers.map(x => x.name) : [];
    const seen = new Map();
    for (const l of labels) seen.set(l, (seen.get(l) || 0) + 1);
    const cells = rivals.map((r, i) => {
      let l = labels[i];
      if (seen.get(l) > 1) { const n = String(order.indexOf(r.name) + 1); l = l.slice(0, Math.max(0, w - n.length)) + n; }
      return T.hudCell({ ...r, name: l });
    });
    return (head + cells.join(sep)).slice(0, width);
  }

  drawHud(m) {
    const { rows, cols, colorMode } = m.conn;
    if (rows < HUD_ROW) return;
    const width = Math.min(cols, NEED_COLS);
    const text = this.hudText(m, width).padEnd(width);
    m.conn.write(`\x1b7\x1b[${HUD_ROW};1H${display.ansiSgr(0, 3, colorMode)}${text}${display.canvasSgr(colorMode)}\x1b8`);
  }
}

module.exports = { Room, NEED_ROWS, NEED_COLS, MAX_ROWS, MAX_COLS };
