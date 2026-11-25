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

class Room {
  // opts: { build, countdownMs = 3000, pollMs = 250, maxPlayers = 8, seed() }
  constructor(opts) {
    this.build = opts.build;
    this.countdownMs = opts.countdownMs === undefined ? 3000 : opts.countdownMs;
    this.pollMs = opts.pollMs || 250;
    this.maxPlayers = opts.maxPlayers || 8;
    this.nextSeed = opts.seed || (() => crypto.randomInt(0, 0x10000));
    this.members = [];                // { conn, name, ready, game, result }
    this.phase = 'lobby';             // lobby | countdown | race
    this.race = null;                 // { seed, racers: [member], startedAt }
    this.lastResults = null;
    this.countdownTimer = null;
    this.countdownEnds = 0;
    this.poller = setInterval(() => this.tick(), this.pollMs);
    this.poller.unref();
  }

  close() {
    clearInterval(this.poller);
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
    const m = { conn, name: this.uniqueName(conn.name), ready: false, game: null, result: null };
    this.members.push(m);
    conn.write('\x1b[?1049h\x1b[?25l');
    if (this.phase === 'countdown') this.cancelCountdown();
    this.drawLobbies();
    return m;
  }

  leave(m) {
    if (!this.members.includes(m)) return;
    console.log(`[versus] ${m.name} left (${this.members.length - 1} online)`);
    if (m.game) {
      const s = m.game.stats();
      m.game.stop();
      m.game = null;
      if (!m.result) this.setResult(m, 'left', s);
    }
    this.members = this.members.filter(x => x !== m);
    try { m.conn.write('\x1b[0m\x1b[?25h\x1b[?1049l'); m.conn.close(); } catch (_) { /* gone */ }
    this.maybeEndRace();
    this.maybeCountdown();
    this.drawLobbies();
  }

  resize(m, rows, cols) {
    m.conn.rows = rows;
    m.conn.cols = cols;
    if (m.game) { m.game.repaint(rows, cols); this.drawHud(m); } else this.drawLobby(m);
  }

  input(m, data) {
    const s = data.toString('utf8');
    if (m.game) {
      if (s.includes('\x03')) { this.forfeit(m); return; }   // Ctrl-C: give up, back to the lobby
      m.game.pushKeys(s);
      return;
    }
    for (const ch of s) {
      if (ch === 'q' || ch === 'Q' || ch === '\x03' || ch === '\x04') { this.leave(m); return; }
      if ((ch === '\r' || ch === '\n' || ch === ' ') && this.phase !== 'race') {
        m.ready = !m.ready;
        if (!m.ready) this.cancelCountdown();
        this.maybeCountdown();
        this.drawLobbies();
      }
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
      this.drawLobbies();
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
    this.drawLobbies();
  }

  forfeit(m) {
    if (!m.game) return;
    const s = m.game.stats();
    m.game.stop();
    m.game = null;
    if (!m.result) this.setResult(m, 'quit', s);
    this.backToLobby(m);
  }

  gameExited(m, reason, detail) {
    if (!m.game) return;
    const s = m.game.stats();
    m.game = null;
    if (reason === 'error') console.error(`[versus] ${m.name}: game error: ${detail}`);
    if (!m.result) this.setResult(m, reason === 'error' ? 'crashed' : 'quit', s);
    this.backToLobby(m);
  }

  backToLobby(m) {
    this.maybeEndRace();
    this.drawLobbies();
  }

  setResult(m, outcome, s) {
    m.result = { outcome, depth: s.depth, best: s.best, core: s.core, kills: s.kills, turns: s.turns, at: Date.now() };
  }

  maybeEndRace() {
    if (this.phase !== 'race') return;
    if (this.race.racers.some(m => m.game || !m.result)) return;
    this.lastResults = this.standings();
    this.race = null;
    this.phase = 'lobby';
    for (const m of this.members) m.result = null;
    this.maybeCountdown();
  }

  // Poll every racer's memory: record finishes, return finished racers who left
  // the end screen, and refresh everyone's rival line.
  tick() {
    if (this.phase !== 'race') return;
    for (const m of this.race.racers) {
      if (!m.game) continue;
      const s = m.game.stats();
      if (!m.result && (s.state === GAME.DEAD || s.state === GAME.WON)) this.setResult(m, s.state === GAME.WON ? 'won' : 'dead', s);
      if (m.result && s.state === GAME.TITLE) { m.game.stop(); m.game = null; this.backToLobby(m); }
    }
    if (this.phase !== 'race') return;
    for (const m of this.race.racers) if (m.game) this.drawHud(m);
    for (const m of this.members) if (!m.game && this.race && !this.race.racers.includes(m)) this.drawLobby(m);
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
  drawLobbies() { for (const m of this.members) if (!m.game) this.drawLobby(m); }

  drawLobby(m) {
    const { rows = 24, cols = 80, colorMode } = m.conn;
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
    const sgr = display.canvasSgr(colorMode);
    const accent = display.ansiSgr(11, 0, colorMode, ';1');
    let out = display.fillCanvasAnsi(rows, cols, colorMode);
    lines.slice(0, Math.max(1, rows - 1)).forEach((line, i) => {
      out += `\x1b[${i + 2};3H${i === 0 ? accent : sgr}${line.slice(0, Math.max(0, cols - 4))}`;
    });
    m.conn.write(out + sgr);
  }

  hudText(m) {
    const rivals = this.standings().filter(r => r.name !== m.name);
    const body = rivals.length ? rivals.map(T.hudCell).join('  |  ') : T.hudNone;
    return ` ${T.hudLabel}  ${body}`;
  }

  drawHud(m) {
    const { rows = 24, cols = 80, colorMode } = m.conn;
    if (rows < HUD_ROW) return;
    const text = this.hudText(m).slice(0, cols).padEnd(Math.min(cols, NEED_COLS));
    m.conn.write(`\x1b7\x1b[${HUD_ROW};1H${display.ansiSgr(0, 3, colorMode)}${text}${display.canvasSgr(colorMode)}\x1b8`);
  }
}

module.exports = { Room, NEED_ROWS, NEED_COLS };
