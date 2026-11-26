'use strict';
// Daily board, profiles, SSH key identity and the post-race chronicle (issue #32).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, utils } = require('ssh2');
const { startServer, buildGame } = require('../server');
const { GAME } = require('../vm');
const { Store, utcDate, dailySeed, buildId, fingerprint } = require('../store');

const game = buildGame();
const hostKey = utils.generateKeyPairSync('ed25519').private;
const userKey = utils.generateKeyPairSync('ed25519');
const userFp = fingerprint(utils.parseKey(userKey.public).getPublicSSH());
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await wait(20); }
  throw new Error('timed out waiting for condition');
}
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scrap-records-'));
function connect(port, username, extra = {}) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c)).on('error', reject).connect({ host: '127.0.0.1', port, username, tryKeyboard: true, ...extra });
  });
}
function shell(c) {
  return new Promise((resolve, reject) => c.shell({ term: 'xterm-256color', rows: 31, cols: 100 }, (err, s) => {
    if (err) return reject(err);
    s.out = '';
    s.on('data', d => { s.out += d.toString(); });
    resolve(s);
  }));
}
const run = (fp, handle, place, outcome, best, ms, turns = 50) => ({ fp, handle, place, outcome, best, ms, turns, kills: 0 });

test('the daily seed is fixed per UTC date and differs between dates', () => {
  assert.strictEqual(utcDate(Date.UTC(2026, 10, 25, 23, 59)), '2026-11-25');
  assert.strictEqual(utcDate(Date.UTC(2026, 10, 26, 0, 0)), '2026-11-26');
  assert.strictEqual(dailySeed('2026-11-25'), dailySeed('2026-11-25'));
  assert.notStrictEqual(dailySeed('2026-11-25'), dailySeed('2026-11-26'));
  assert.ok(dailySeed('2026-11-25') >= 0 && dailySeed('2026-11-25') <= 0xFFFF);
});

test('profiles and daily boards save atomically and reload; a board keeps each player\'s best run', () => {
  const dir = tmpDir();
  const daily = { date: '2026-11-25', build: 'abc123', seed: 4242 };
  const s = new Store(dir);
  s.recordRace([run('fpA', 'ann', 1, 'won', 0, 90000), run('fpB', 'bob', 2, 'dead', 6, 40000), run(null, 'guest', 3, 'quit', 8, 1000)], daily);
  s.recordRace([run('fpB', 'bobby', 1, 'won', 0, 80000), run('fpA', 'ann', 2, 'dead', 9, 5000)], daily);
  s.recordRace([run('fpA', 'ann', 1, 'dead', 7, 3000)], null);           // random seed: profile only
  const files = fs.readdirSync(dir).concat(fs.readdirSync(path.join(dir, 'daily')));
  assert.ok(!files.some(f => f.endsWith('.tmp')), `no temp files left: ${files}`);
  const r = new Store(dir);
  assert.deepStrictEqual(r.profile('fpA'), { handle: 'ann', races: 3, wins: 1, bestDepth: 0, fastestWinMs: 90000 });
  assert.deepStrictEqual(r.profile('fpB'), { handle: 'bobby', races: 2, wins: 1, bestDepth: 0, fastestWinMs: 80000 });
  assert.strictEqual(r.profile('guest'), null);
  const b = r.board('2026-11-25', 'abc123', 4242);
  assert.deepStrictEqual(b.entries.map(e => `${e.handle}:${e.outcome}:${e.ms}`), ['bobby:won:80000', 'ann:won:90000']);
  assert.ok(!JSON.stringify(b).includes('guest'), 'guests are never on the board');
  assert.deepStrictEqual(r.board('2026-11-25', 'other', 4242).entries, [], 'another build has its own board');
});

test('a damaged profiles file is moved aside, not overwritten', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'profiles.json'), '{ not json');
  const s = new Store(dir);
  s.recordRace([run('fpA', 'ann', 1, 'won', 0, 1000)], null);
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('profiles.json.corrupt-')));
  assert.strictEqual(new Store(dir).profile('fpA').races, 1);
});

test('an SSH key gives a verified identity; keyless guests still play; a password still applies', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, store: null });
  const clients = [];
  try {
    clients.push(await connect(srv.port, 'keyed', { privateKey: userKey.private }));
    clients.push(await connect(srv.port, 'guest'));
    for (const c of clients) await shell(c);
    await until(() => srv.room.members.length === 2);
    const [keyed, guest] = srv.room.members;
    assert.strictEqual(keyed.fp, userFp);
    assert.strictEqual(guest.fp, null);
  } finally { for (const c of clients) c.end(); srv.close(); }

  // A forged signature for someone else's public key earns no identity: guest only.
  const open = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, store: null });
  try {
    const forged = utils.parseKey(userKey.private);
    forged.sign = () => Buffer.alloc(64, 7);
    const c = await connect(open.port, 'forger', { authHandler: [{ type: 'publickey', username: 'forger', key: forged }, { type: 'keyboard-interactive', username: 'forger', prompt: (_n, _i, _l, _p, done) => done([]) }] });
    await shell(c);
    await until(() => open.room.members.length === 1);
    assert.strictEqual(open.room.members[0].fp, null);
    c.end();
  } finally { open.close(); }

  const locked = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, store: null, password: 'hunter2' });
  try {
    await assert.rejects(connect(locked.port, 'keyed', { privateKey: userKey.private, tryKeyboard: false }), 'a key alone does not skip the password');
    // OpenSSH's order: the key first, then the password.
    const ok = await connect(locked.port, 'keyed', { privateKey: userKey.private, password: 'hunter2', authHandler: ['publickey', 'password'] });
    await shell(ok);
    await until(() => locked.room.members.length === 1);
    assert.strictEqual(locked.room.members[0].fp, userFp);
    ok.end();
  } finally { locked.close(); }
});

test('a daily race uses the day\'s seed, ranks keyed racers on the board, and shows a chronicle', async () => {
  const dir = tmpDir();
  const now = () => Date.UTC(2026, 10, 25, 12, 0);
  const date = '2026-11-25';
  const srv = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, dataDir: dir, now, countdownMs: 0, endScreenMs: 0, seed: () => 1 });
  const clients = [];
  try {
    clients.push(await connect(srv.port, 'keyed', { privateKey: userKey.private }));
    clients.push(await connect(srv.port, 'guest'));
    const [ks, gs] = [await shell(clients[0]), await shell(clients[1])];
    await until(() => srv.room.members.length === 2);
    ks.write('d');
    await until(() => srv.room.daily && /daily seed for 2026-11-25/.test(gs.out));
    ks.write('\r'); gs.write('\r');
    await until(() => srv.room.phase === 'race' && srv.room.members.every(m => m.game && m.game.stats().state === GAME.PLAY));
    assert.strictEqual(srv.room.race.seed, dailySeed(date));
    const [k, g] = srv.room.race.racers;
    // keyed climbs one floor, then surfaces; guest is destroyed by a Rifler (EN_RIFLER = 3)
    k.game.poke('st_climb', 1); k.game.pushKeys('.');
    await until(() => k.game.splits.some(s => s.depth === 9));
    k.game.poke('st_game_state', GAME.WON);
    g.game.poke('st_core_hp', 0); g.game.poke('st_death_cause', 3); g.game.poke('st_game_state', GAME.DEAD);
    await until(() => srv.room.phase === 'lobby');

    const [first, second] = srv.room.lastResults;
    assert.strictEqual(first.name, 'keyed');
    assert.ok(first.chronicle.loadout.length > 0 && first.chronicle.loadout.every(n => /^[A-Za-z][A-Za-z -]*$/.test(n)), `loadout names: ${first.chronicle.loadout}`);
    assert.deepStrictEqual(first.chronicle.splits.map(s => s.depth), [10, 9]);
    assert.strictEqual(second.chronicle.cause, 'Rifler');

    const saved = new Store(dir);
    const b = saved.board(date, buildId(game), dailySeed(date));
    assert.deepStrictEqual(b.entries.map(e => `${e.handle}:${e.outcome}`), ['keyed:won']);
    assert.strictEqual(b.entries[0].fp, userFp);
    assert.deepStrictEqual(saved.profile(userFp), { handle: 'keyed', races: 1, wins: 1, bestDepth: 9, fastestWinMs: b.entries[0].ms });

    ks.out = '';
    ks.write('\t');                 // daily board view
    await until(() => /DAILY BOARD/.test(ks.out) && /keyed/.test(ks.out) && /1 race, 1 win/.test(ks.out));
    gs.out = '';
    gs.write('\t'); await wait(80); gs.write('\t');   // guest: board, then chronicle
    await until(() => /LAST RACE/.test(gs.out) && /Loadout: /.test(gs.out) && /Rifler/.test(gs.out) && /D9 \d+:\d\d/.test(gs.out));
  } finally { for (const c of clients) c.end(); srv.close(); }
});
