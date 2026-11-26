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
const { spawn, spawnSync } = require('child_process');
const { Store, utcDate, dailySeed, buildId, fingerprint, better } = require('../store');
const { Room } = require('../room');

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
    c.on('ready', () => resolve(c)).on('error', reject).on('close', () => reject(new Error('connection closed before login')))
      .connect({ host: '127.0.0.1', port, username, tryKeyboard: true, ...extra });
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
    k.game.poke('st_depth', 0); k.game.poke('st_depth_best', 0);   // what main does on reaching the Surface
    k.game.poke('st_game_state', GAME.WON);
    g.game.poke('st_core_hp', 0); g.game.poke('st_death_cause', 3); g.game.poke('st_game_state', GAME.DEAD);
    await until(() => srv.room.phase === 'lobby');

    const [first, second] = srv.room.lastResults;
    assert.strictEqual(first.name, 'keyed');
    assert.ok(first.chronicle.loadout.length > 0 && first.chronicle.loadout.every(n => /^[A-Za-z][A-Za-z -]*$/.test(n)), `loadout names: ${first.chronicle.loadout}`);
    assert.deepStrictEqual(first.chronicle.splits.map(s => s.depth), [10, 9, 0]);
    assert.strictEqual(second.chronicle.cause, 'Rifler');

    const saved = new Store(dir);
    const b = saved.board(date, buildId(game), dailySeed(date));
    assert.deepStrictEqual(b.entries.map(e => `${e.handle}:${e.outcome}`), ['keyed:won']);
    assert.strictEqual(b.entries[0].fp, userFp);
    assert.deepStrictEqual(saved.profile(userFp), { handle: 'keyed', races: 1, wins: 1, bestDepth: 0, fastestWinMs: b.entries[0].ms });

    ks.out = '';
    ks.write('\t');                 // daily board view
    await until(() => /DAILY BOARD/.test(ks.out) && /keyed/.test(ks.out) && /1 race, 1 win/.test(ks.out));
    gs.out = '';
    gs.write('\t'); await wait(80); gs.write('\t');   // guest: board, then chronicle
    await until(() => /LAST RACE/.test(gs.out) && /Loadout: /.test(gs.out) && /Rifler/.test(gs.out) && /D9 \d+:\d\d/.test(gs.out));
  } finally { for (const c of clients) c.end(); srv.close(); }
});

test('one key in two seats counts once; a forfeit never outranks a run that ended in play', () => {
  const dir = tmpDir();
  const daily = { date: '2026-11-25', build: 'b', seed: 1 };
  const s = new Store(dir);
  s.recordRace([run('fpA', 'alice', 1, 'won', 0, 50000), run('fpA', 'alice2', 2, 'quit', 10, 500)], daily);
  assert.deepStrictEqual(s.profile('fpA'), { handle: 'alice', races: 1, wins: 1, bestDepth: 0, fastestWinMs: 50000 });
  assert.deepStrictEqual(s.board('2026-11-25', 'b', 1).entries.map(e => e.handle), ['alice']);
  const dead = run('x', 'x', 1, 'dead', 10, 60000), quit = run('y', 'y', 1, 'quit', 10, 200);
  assert.ok(better(dead, quit) < 0, 'destroyed at Depth 10 beats an instant forfeit at Depth 10');
  assert.ok(better(run('z', 'z', 1, 'quit', 9, 200), dead) < 0, 'shallower still wins first');
  s.recordRace([run('fpB', 'bob', 1, 'dead', 10, 60000)], daily);
  s.recordRace([run('fpB', 'bob', 1, 'quit', 10, 200)], daily);       // a later instant forfeit does not replace it
  assert.strictEqual(s.board('2026-11-25', 'b', 1).entries.find(e => e.fp === 'fpB').outcome, 'dead');
  // a second place on the Surface is neither a win nor a fastest win
  s.recordRace([run('fpC', 'cat', 1, 'won', 0, 1000), run('fpD', 'dan', 2, 'won', 0, 2000)], null);
  assert.deepStrictEqual([s.profile('fpD').wins, s.profile('fpD').fastestWinMs], [0, null]);
});

test('a failed save changes nothing; damaged-but-valid JSON is moved aside, not trusted', () => {
  const dir = tmpDir();
  const daily = { date: '2026-11-25', build: 'b', seed: 1 };
  const s = new Store(dir);
  fs.mkdirSync(path.join(dir, 'daily'));
  fs.mkdirSync(s.boardFile('2026-11-25', 'b', 1));    // the board path is a directory: its write fails
  assert.throws(() => s.recordRace([run('fpA', 'ann', 1, 'won', 0, 1000)], daily));
  assert.strictEqual(s.profile('fpA'), null, 'profile unchanged in memory');
  assert.strictEqual(new Store(dir).profile('fpA'), null, 'and on disk');
  for (const [name, text] of [['profiles.json', '[]'], ['profiles.json', 'null'], ['profiles.json', '{"k":42}']]) {
    const d = tmpDir();
    fs.writeFileSync(path.join(d, name), text);
    const st = new Store(d);
    assert.deepStrictEqual(st.profiles, {}, text);
    assert.ok(fs.readdirSync(d).some(f => f.startsWith('profiles.json.corrupt-')), text);
  }
  for (const text of ['{}', 'null', '{"entries":null}', '{"entries":[1]}']) {
    const d = tmpDir();
    const st = new Store(d);
    fs.mkdirSync(path.join(d, 'daily'));
    fs.writeFileSync(st.boardFile('2026-11-25', 'b', 1), text);
    assert.deepStrictEqual(st.board('2026-11-25', 'b', 1).entries, [], text);
  }
});

test('the lobby ignores arrow keys, only Tab and q work off the lobby view, and the date rolls over at UTC midnight', async () => {
  let t = Date.UTC(2026, 10, 25, 23, 59, 59);
  const out = [];
  const room = new Room({ build: game, store: new Store(tmpDir()), now: () => t, pollMs: 20, countdownMs: 60000 });
  try {
    const m = room.join({ name: 'ann', rows: 31, cols: 100, colorMode: 'truecolor', write: s => out.push(s), close() {} });
    room.input(m, Buffer.from('\x1b[D'));        // Left arrow ends in 'D'
    assert.strictEqual(room.daily, false);
    room.input(m, Buffer.from('\x1bOQ'));        // F2 ends in 'Q'
    assert.ok(room.members.includes(m));
    room.input(m, Buffer.from('\t'));            // board view
    room.input(m, Buffer.from('d'));
    room.input(m, Buffer.from('\r'));
    assert.strictEqual(room.daily, false);
    assert.strictEqual(m.ready, false);
    await until(() => out.join('').includes('2026-11-25 UTC'));
    t += 2000;                                   // past midnight: the idle board redraws for the new day
    await until(() => out.join('').includes('2026-11-26 UTC'));
  } finally { room.close(); }
});

test('unreadable keys (security keys, certificates) are skipped without locking the player out', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, store: null });
  try {
    const blob = Buffer.concat([Buffer.from([0, 0, 0, 26]), Buffer.from('sk-ssh-ed25519@openssh.com'), Buffer.alloc(40, 1)]);
    // A real key object dressed up as a FIDO key: ssh2 on the server cannot parse its blob.
    const keys = Array.from({ length: 6 }, () => {
      const sk = utils.parseKey(utils.generateKeyPairSync('ed25519').private);
      sk.type = 'sk-ssh-ed25519@openssh.com'; sk.getPublicSSH = () => blob; sk.sign = () => Buffer.alloc(64, 1);
      return { type: 'publickey', username: 'fido', key: sk };
    });
    const c = await connect(srv.port, 'fido', { authHandler: [...keys, { type: 'keyboard-interactive', username: 'fido', prompt: (_n, _i, _l, _p, done) => done([]) }] });
    await shell(c);
    await until(() => srv.room.members.length === 1);
    assert.strictEqual(srv.room.members[0].fp, null);
    c.end();
  } finally { srv.close(); }
});

const hasSsh = spawnSync('ssh', ['-V']).status === 0;
test('OpenSSH logs in with RSA and Ed25519 keys and gets the ssh-keygen fingerprint', { skip: !hasSsh && 'no ssh client' }, async () => {
  const dir = tmpDir();
  const srv = await startServer({ port: 0, host: '127.0.0.1', hostKey, build: game, store: null });
  try {
    for (const [type, bits] of [['rsa', '2048'], ['ed25519', null]]) {
      const key = path.join(dir, `id_${type}`);
      spawnSync('ssh-keygen', ['-q', '-t', type, ...(bits ? ['-b', bits] : []), '-N', '', '-f', key]);
      const want = spawnSync('ssh-keygen', ['-lf', `${key}.pub`]).stdout.toString().split(' ')[1];
      const ssh = spawn('ssh', ['-p', String(srv.port), '-tt', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'IdentitiesOnly=yes', '-o', 'LogLevel=ERROR', '-i', key, `${type}@127.0.0.1`], { stdio: ['pipe', 'ignore', 'pipe'] });
      let err = '';
      ssh.stderr.on('data', d => { err += d; });
      try {
        await until(() => srv.room.members.some(m => m.fp === want) || (ssh.exitCode !== null && assert.fail(`${type}: ssh exited: ${err}`)), 10000);
      } finally { ssh.kill(); }
      await until(() => srv.room.members.length === 0);
    }
  } finally { srv.close(); }
});
