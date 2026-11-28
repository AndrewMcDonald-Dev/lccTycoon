'use strict';
// Versus server tests: real SSH clients (ssh2) against a real server on a free port.
const test = require('node:test');
const assert = require('node:assert');
const { Client, utils } = require('ssh2');
const { startServer, buildGame } = require('../server');
const { RaceGame, GAME } = require('../vm');
const { Room } = require('../room');

const game = buildGame();
const hostKey = utils.generateKeyPairSync('ed25519').private;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await wait(20); }
  throw new Error('timed out waiting for condition');
}

function connect(port, username, extra = {}) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c)).on('error', reject).connect({ host: '127.0.0.1', port, username, tryKeyboard: true, ...extra });
  });
}
function shell(c, rows = 31, cols = 100) {
  // ssh2 sends these as the pty-req uint32 sizes, so a client can claim any size.
  return new Promise((resolve, reject) => c.shell({ term: 'xterm-256color', rows, cols }, (err, s) => {
    if (err) return reject(err);
    s.out = '';
    s.on('data', d => { s.out += d.toString(); });
    resolve(s);
  }));
}

function snapshot(g) {
  const sym = g.sym, mem = g.mem;
  const words = (name, n) => Array.from(mem.slice(sym[name], sym[name] + n));
  const time = mem[sym.st_time];
  // E_NEXT (word 4) is on the scheduler clock, which differs with turns played: compare it relative to st_time.
  const raw = words('st_enemies', 24 * 16);
  const enemies = raw.map((w, i) => (i % 16 === 4 && raw[i - 4] !== 0 ? (w - time) & 0xFFFF : w));
  return { map: words('st_map', 64 * 24).join(), enemies: enemies.join(), items: words('st_items', 32 * 4).join(), slots: words('st_slots', 16).join() };
}
function runGame(seed) {
  const g = new RaceGame({ build: game, seed, race: true, onOutput: () => {}, onExit: () => {} });
  g.start();
  return g;
}
async function climb(g, depth) {
  g.poke('st_climb', 1);
  g.pushKeys('.');
  // st_depth drops before main_new_floor builds the floor in the same frame, and the
  // VM runs in batches: wait for the frame's sleep (!running) so the floor is complete.
  await until(() => g.stats().depth === depth && g.stats().state === GAME.PLAY && !g.running);
}

test('racers with the same seed get the same loadout and floors even after playing differently', async () => {
  const a = runGame(4321), b = runGame(4321);
  try {
    await until(() => a.stats().state === GAME.PLAY && b.stats().state === GAME.PLAY);
    assert.deepStrictEqual(snapshot(a), snapshot(b), 'depth 10 differs');
    a.pushKeys('..j.k.h.l..');                 // a burns RNG draws that b does not
    await until(() => a.keyQueue.length === 0 && a.stats().turns >= 6);
    await wait(100);                            // let the last queued action finish
    await climb(a, 9);
    await climb(b, 9);
    const sa = snapshot(a), sb = snapshot(b);
    assert.strictEqual(sa.map, sb.map, 'depth 9 map differs');
    assert.strictEqual(sa.enemies, sb.enemies, 'depth 9 robots differ');
    assert.strictEqual(sa.items, sb.items, 'depth 9 loot differs');
  } finally { a.stop(); b.stop(); }
});

test('a different seed gives a different first floor', async () => {
  const a = runGame(1), b = runGame(2);
  try {
    await until(() => a.stats().state === GAME.PLAY && b.stats().state === GAME.PLAY);
    assert.notStrictEqual(snapshot(a).map, snapshot(b).map);
  } finally { a.stop(); b.stop(); }
});

test('four players race at once over SSH, see each other, and get ranked', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, maxPlayers: 8, countdownMs: 200, endScreenMs: 500, seed: () => 777 });
  const names = ['ann', 'bob', 'cat', 'dan'];
  const clients = [];
  try {
    for (const n of names) clients.push(await connect(srv.port, n));
    const streams = [];
    for (const c of clients) streams.push(await shell(c));
    await until(() => srv.room.members.length === 4);
    await until(() => /dan/.test(streams[0].out));   // lobby lists later players
    for (const s of streams) s.write('\r');
    await until(() => srv.room.phase === 'race' && srv.room.members.every(m => m.game && m.game.stats().state === GAME.PLAY));
    assert.strictEqual(srv.room.race.racers.length, 4);
    // ann sees all three rivals on the rival line under the game
    await until(() => /\x1b\[31;1H\x1b\[[0-9;]*m RIVALS[^\x1b]*bob[^\x1b]*cat[^\x1b]*dan/.test(streams[0].out));
    // a fifth player joining mid-race waits in the lobby with live standings
    const late = await connect(srv.port, 'eve');
    const ls = await shell(late);
    await until(() => /ann/.test(ls.out) && /dan/.test(ls.out));
    assert.strictEqual(srv.room.race.racers.length, 4);
    // finish: dan wins, bob is destroyed at depth 10, cat gives up, ann disconnects.
    // dan and bob then idle on their end screens; that must not hold up the next race.
    const [ann, bob, cat, dan] = srv.room.race.racers;
    dan.game.poke('st_game_state', GAME.WON);
    bob.game.poke('st_core_hp', 0); bob.game.poke('st_game_state', GAME.DEAD);
    await until(() => dan.result && bob.result);
    streams[2].write('\x03');
    clients[0].end();
    await wait(250);
    assert.ok(srv.room.phase === 'race' && dan.game && bob.game, 'finished racers keep their end screens for a while');
    await until(() => srv.room.phase === 'lobby');
    assert.ok(!dan.game && !bob.game, 'finished racers idling on their end screens go back to the lobby');
    assert.deepStrictEqual(srv.room.lastResults.map(r => `${r.name}:${r.outcome}`), ['dan:won', 'ann:left', 'bob:dead', 'cat:quit']);
    assert.strictEqual(srv.room.members.length, 4);  // bob, cat, dan, eve
    late.end();
  } finally {
    for (const c of clients) c.end();
    srv.close();
  }
});

test('guests get the game only: no exec, sftp or port forwarding', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game });
  const c = await connect(srv.port, 'mallory');
  try {
    await assert.rejects(new Promise((res, rej) => c.exec('id', (err, s) => {
      if (err) return rej(err);
      let out = ''; s.on('data', d => { out += d; }).on('close', code => (out || code === 0) ? res(out) : rej(new Error(`exec closed, code ${code}`)));
    })));
    await assert.rejects(new Promise((res, rej) => c.sftp((err, s) => err ? rej(err) : res(s))));
    await assert.rejects(new Promise((res, rej) => c.forwardOut('127.0.0.1', 1, '127.0.0.1', 22, (err, s) => err ? rej(err) : res(s))));
    await assert.rejects(new Promise((res, rej) => c.forwardIn('127.0.0.1', 0, (err, p) => err ? rej(err) : res(p))));
  } finally { c.end(); srv.close(); }
});

test('a password, when set, is required', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, password: 'hunter2' });
  try {
    await assert.rejects(connect(srv.port, 'guest', { password: 'wrong', tryKeyboard: false }));
    await assert.rejects(connect(srv.port, 'guest', { tryKeyboard: false }));
    const ok = await connect(srv.port, 'guest', { password: 'hunter2' });
    ok.end();
  } finally { srv.close(); }
});

test('finish order is the order racers finished, not the poll order', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, countdownMs: 0, endScreenMs: 0, seed: () => 99 });
  const clients = [];
  try {
    for (const n of ['first', 'second']) clients.push(await connect(srv.port, n));
    const streams = [];
    for (const c of clients) streams.push(await shell(c));
    await until(() => srv.room.members.length === 2);
    for (const s of streams) s.write('\r');
    await until(() => srv.room.phase === 'race' && srv.room.members.every(m => m.game && m.game.stats().state === GAME.PLAY));
    const [a, b] = srv.room.race.racers;          // roster order: a, then b
    b.game.poke('st_game_state', GAME.WON);       // b surfaces first ...
    await until(() => b.game.endState === GAME.WON, 1000);
    a.game.poke('st_game_state', GAME.WON);       // ... a a moment later, inside the same 250 ms poll
    await until(() => srv.room.phase === 'lobby');
    assert.deepStrictEqual(srv.room.lastResults.map(r => `${r.name}:${r.outcome}`), [`${b.name}:won`, `${a.name}:won`]);
  } finally { for (const c of clients) c.end(); srv.close(); }
});

test('a guest claiming a huge terminal cannot crash the server or stall the lobby', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, countdownMs: 0 });
  const clients = [];
  try {
    clients.push(await connect(srv.port, 'huge'));
    const big = await shell(clients[0], 65535, 65535);
    await until(() => srv.room.members.length === 1);
    const m = srv.room.members[0];
    assert.ok(m.conn.rows <= 200 && m.conn.cols <= 500, `size clamped, got ${m.conn.rows}x${m.conn.cols}`);
    big.setWindow(0x7FFFFFFF, 0x7FFFFFFF, 0, 0);
    clients.push(await connect(srv.port, 'normal'));
    const ok = await shell(clients[1]);
    await until(() => srv.room.members.length === 2);
    big.write('\r'); ok.write('\r');
    await until(() => srv.room.phase === 'race');
  } finally { for (const c of clients) c.end(); srv.close(); }
});

test('the rival line keeps every rival readable with eight racers in 100 columns', () => {
  const room = new Room({ build: game });
  try {
    const names = ['abcdefghijkl', 'mnopqrstuvwx', 'yzABCDEFGHIJ', 'KLMNOPQRSTUV', 'WXYZ01234567', 'robot_number', 'another-one1', 'me'];
    const racers = names.map((name, i) => ({ name, result: null, game: { stats: () => ({ state: GAME.PLAY, depth: 10 - i, best: 10 - i, core: 40, kills: 0, turns: 5 }) } }));
    room.phase = 'race';
    room.race = { seed: 1, racers, startedAt: 0 };
    const line = room.hudText(racers[7], 100);
    assert.ok(line.length <= 100, `line is ${line.length} chars`);
    for (let i = 0; i < 7; i++) assert.match(line, new RegExp(`D${10 - i} C40`), `rival ${i} keeps its status: ${line}`);
    // look-alike names stay distinct when shortened
    racers.forEach((r, i) => { r.name = i ? `robot${i + 1}` : 'robot'; });
    const shortNames = room.hudText(racers[7], 100).replace(/^\s*RIVALS\s+/, '').split(' | ').map(c => c.split(' ')[0]);
    assert.strictEqual(new Set(shortNames).size, 7, `distinct: ${shortNames}`);
    // unrelated names that shorten alike, and a long status, still fit in full
    ['robot', 'rust', 'rabbit', 'riot', 'root', 'rat', 'rot', 'me'].forEach((n, i) => { racers[i].name = n; });
    racers[0].result = { outcome: 'won', depth: 0, best: 0, core: 40, kills: 0, turns: 9, at: 1 };
    const mixed = room.hudText(racers[7], 100);
    assert.ok(mixed.length <= 100 && /SURFACED/.test(mixed), mixed);
    for (let i = 1; i < 7; i++) assert.match(mixed, new RegExp(`D${10 - i} C40`), mixed);
    const labels = mixed.replace(/^\s*RIVALS\s+/, '').split(' | ').map(c => c.split(' ')[0]);
    assert.strictEqual(new Set(labels).size, 7, `distinct: ${labels}`);
    // numbered labels cannot clash with names that already look like them
    for (const set of [['robot', 'rot', 'robot2', 'rust', 'riot', 'ro1', 'r2', 'me'], ['alice', 'robot', 'robot2', 'rust', 'rat', 'rot', 'rr', 'me']]) {
      set.forEach((n, i) => { racers[i].name = n; });
      const ls = room.hudText(racers[7], 100).replace(/^\s*RIVALS\s+/, '').split(' | ').map(c => c.split(' ')[0]);
      assert.strictEqual(new Set(ls).size, 7, `distinct: ${ls}`);
    }
  } finally { room.close(); }
});

test('[r] rematches the last race on the same seed (off the daily board) and the lobby shows that seed', async () => {
  let n = 0x1A2B;
  const out = [];
  const room = new Room({ build: game, seed: () => n++, pollMs: 20, countdownMs: 0, endScreenMs: 0 });
  const screen = () => out.join('');
  try {
    const m = room.join({ name: 'ann', rows: 31, cols: 100, colorMode: 'truecolor', write: s => out.push(s), close() {} });
    room.input(m, Buffer.from('r'));                 // no last race yet: nothing to rematch
    assert.strictEqual(room.rematch, false);
    const race = async () => {
      room.input(m, Buffer.from('\r'));
      await until(() => room.phase === 'race' && m.game && m.game.stats().state === GAME.PLAY);
      const seed = room.race.seed, before = room.lastRace;
      room.input(m, Buffer.from('\x03'));            // give up: back to the lobby
      await until(() => room.phase === 'lobby' && room.lastRace !== before);
      return seed;
    };
    const first = await race();
    assert.strictEqual(first, 0x1A2B);
    await until(() => /Last race -- seed #1A2B/.test(screen()) && /\[r\] rematch/.test(screen()));
    room.input(m, Buffer.from('r'));
    assert.strictEqual(room.rematch, true);
    await until(() => /rematch on seed #1A2B/.test(screen()));
    assert.strictEqual(await race(), 0x1A2B, 'rematch reuses the seed');
    assert.strictEqual(room.lastRace.daily, null, 'a rematch is not a daily race');
    room.input(m, Buffer.from('d'));                 // daily and rematch exclude each other
    assert.deepStrictEqual([room.daily, room.rematch], [true, false]);
    room.input(m, Buffer.from('r'));
    assert.deepStrictEqual([room.daily, room.rematch], [false, true]);
    room.input(m, Buffer.from('r'));                 // off again: a fresh random seed
    assert.strictEqual(await race(), 0x1A2C);
  } finally { room.close(); }
});

test('two or more ready players start without the rest after autoStartMs; dropping below two resets the wait', async () => {
  // pollMs above the 30 ms redraw debounce, as in production: lobbies must redraw when the wait is dropped.
  const room = new Room({ build: game, pollMs: 100, countdownMs: 60000, autoStartMs: 600, endScreenMs: 0 });
  const conn = name => ({ name, rows: 31, cols: 100, colorMode: 'truecolor', write() {}, close() {} });
  const waitLine = /starting with ready players in \d+s/;
  try {
    const [a, b, c] = ['ann', 'bob', 'cat'].map(n => room.join(conn(n)));
    room.input(a, Buffer.from('\r'));
    await wait(700);
    assert.strictEqual(room.phase, 'lobby', 'one ready player waits for the others');
    assert.strictEqual(room.autoStartAt, 0);
    room.input(b, Buffer.from('\r'));
    assert.ok(room.autoStartAt, 'the second ready player starts the wait at once');
    await until(() => waitLine.test(c.lobbyText));                // everyone sees the wait
    room.input(b, Buffer.from('\r'));                              // bob unreadies: one ready, wait dropped
    assert.strictEqual(room.autoStartAt, 0);
    await until(() => !waitLine.test(c.lobbyText) && /READY/.test(c.lobbyText));
    await wait(150);
    assert.ok(!waitLine.test(c.lobbyText), 'the lobby does not keep showing a dropped wait');
    const first = (room.input(b, Buffer.from('\r')), room.autoStartAt);
    await wait(150);
    room.input(b, Buffer.from('\r'));                              // unready and ready again within one poll
    room.input(b, Buffer.from('\r'));
    assert.ok(room.autoStartAt > first, 'dropping below two between polls still restarts the wait');
    const deadline = room.autoStartAt;
    room.input(c, Buffer.from('\r'));                              // all ready: the countdown takes over
    assert.strictEqual(room.phase, 'countdown');
    room.input(c, Buffer.from('\r'));                              // cancelled: the wait carries on
    assert.strictEqual(room.phase, 'lobby');
    assert.strictEqual(room.autoStartAt, deadline, 'toggling ready cannot restart the wait');
    const t0 = Date.now();
    await until(() => room.phase === 'race');
    assert.ok(Date.now() - t0 >= 300, `waited ${Date.now() - t0} ms`);
    assert.deepStrictEqual(room.race.racers.map(m => m.name), ['ann', 'bob'], 'only the ready players race');
    assert.strictEqual(c.game, null);
    assert.strictEqual(room.autoStartAt, 0);
  } finally { room.close(); }
});

test('a join that cancels an all-ready countdown starts a full auto-start wait', async () => {
  const room = new Room({ build: game, pollMs: 100, countdownMs: 60000, autoStartMs: 30000 });
  const conn = name => ({ name, rows: 31, cols: 100, colorMode: 'truecolor', write() {}, close() {} });
  try {
    const [a, b] = ['ann', 'bob'].map(n => room.join(conn(n)));
    room.input(a, Buffer.from('\r'));
    room.input(b, Buffer.from('\r'));
    assert.strictEqual(room.phase, 'countdown');
    assert.strictEqual(room.autoStartAt, 0, 'no wait while everyone is ready');
    await wait(300);
    const t0 = Date.now();
    room.join(conn('cat'));
    assert.strictEqual(room.phase, 'lobby');
    assert.ok(room.autoStartAt - t0 >= 29900, `wait is ${room.autoStartAt - t0} ms`);
  } finally { room.close(); }
});
