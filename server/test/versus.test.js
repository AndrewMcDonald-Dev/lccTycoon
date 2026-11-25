'use strict';
// Versus server tests: real SSH clients (ssh2) against a real server on a free port.
const test = require('node:test');
const assert = require('node:assert');
const { Client, utils } = require('ssh2');
const { startServer, buildGame } = require('../server');
const { RaceGame, GAME } = require('../vm');

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
    c.on('ready', () => resolve(c)).on('error', reject).connect({ host: '127.0.0.1', port, username, ...extra });
  });
}
function shell(c, rows = 31, cols = 100) {
  return new Promise((resolve, reject) => c.shell({ term: 'xterm-256color', rows, cols }, (err, s) => {
    if (err) return reject(err);
    s.out = '';
    s.on('data', d => { s.out += d.toString(); });
    resolve(s);
  }));
}

function snapshot(g) {
  const sym = g.sym, mem = g.mem;
  const words = (name, n) => Array.from(mem.slice(sym[name], sym[name] + n)).join(',');
  return { map: words('st_map', 64 * 24), enemies: words('st_enemies', 24 * 16), items: words('st_items', 32 * 8), slots: words('st_slots', 16) };
}
function runGame(seed) {
  const g = new RaceGame({ build: game, seed, race: true, onOutput: () => {}, onExit: () => {} });
  g.start();
  return g;
}
async function climb(g, depth) {
  g.poke('st_climb', 1);
  g.pushKeys('.');
  await until(() => g.stats().depth === depth && g.stats().state === GAME.PLAY);
}

test('racers with the same seed get the same loadout and floors even after playing differently', async () => {
  const a = runGame(4321), b = runGame(4321);
  try {
    await until(() => a.stats().state === GAME.PLAY && b.stats().state === GAME.PLAY);
    assert.deepStrictEqual(snapshot(a), snapshot(b), 'depth 10 differs');
    a.pushKeys('..j.k.h.l..');                 // a burns RNG draws that b does not
    await until(() => a.stats().turns >= 6 || a.stats().state !== GAME.PLAY);
    await climb(a, 9);
    await climb(b, 9);
    const sa = snapshot(a), sb = snapshot(b);
    assert.strictEqual(sa.map, sb.map, 'depth 9 map differs');
    assert.strictEqual(sa.enemies.split(',').length, sb.enemies.split(',').length);
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
  const srv = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, maxPlayers: 8, countdownMs: 200, seed: () => 777 });
  const names = ['ann', 'bob', 'cat', 'dan'];
  const clients = [];
  try {
    for (const n of names) clients.push(await connect(srv.port, n));
    const streams = [];
    for (const c of clients) streams.push(await shell(c));
    await until(() => srv.room.members.length === 4);
    assert.match(streams[0].out, /dan/, 'lobby lists later players');
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
    // finish: dan wins, bob is destroyed at depth 10, cat gives up, ann disconnects
    const [ann, bob, cat, dan] = srv.room.race.racers;
    dan.game.poke('st_game_state', GAME.WON);
    bob.game.poke('st_core_hp', 0); bob.game.poke('st_game_state', GAME.DEAD);
    await until(() => dan.result && bob.result);
    streams[2].write('\x03');
    clients[0].end();
    await until(() => cat.result && ann.result);
    assert.strictEqual(srv.room.phase, 'race', 'race lasts until finished racers leave their end screens');
    dan.game.poke('st_game_state', GAME.TITLE);
    bob.game.poke('st_game_state', GAME.TITLE);
    await until(() => srv.room.phase === 'lobby');
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
    await assert.rejects(connect(srv.port, 'guest', { password: 'wrong' }));
    await assert.rejects(connect(srv.port, 'guest'));
    const ok = await connect(srv.port, 'guest', { password: 'hunter2' });
    ok.end();
  } finally { srv.close(); }
});
