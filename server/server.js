#!/usr/bin/env node
'use strict';
// SCRAPCORE versus server. Guests connect with a plain `ssh -p <port> <name>@<host>`
// and get the lobby and the game, nothing else: there is no shell, exec, sftp or
// port forwarding behind this server, only keystrokes into the LCC+ emulator.
//
//   node server/server.js [--port 2222] [--host 0.0.0.0] [--max-players 8]
//   SCRAP_PASSWORD=secret node server/server.js      # require a shared password
//
// The host key is created on first run in server/data/ (keep it so returning
// guests are not warned that the host key changed). Profiles and daily boards
// are saved there too, keyed by each player's SSH public-key fingerprint.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server, utils } = require('ssh2');
const ROOT = path.resolve(__dirname, '..');
const { build, resolveTarget } = require(path.join(ROOT, 'tools/lib/assemble'));
const display = require(path.join(ROOT, 'tools/lib/display'));
const { Room } = require('./room');
const { Store, fingerprint } = require('./store');
const T = require('./text');

const ADMIT_MS = 30000;          // connect → in the lobby, or the connection is dropped
const IDLE_MS = 45000;           // raw socket silence (pre-handshake, or a dead peer; keepalives are every 15 s)
const MAX_AUTH_FAILS = 5;
const MAX_BUFFERED = 1 << 20;    // output queued for a guest who stopped reading: drop them
const MIN_PACKET = 1024;         // ssh2 1.17 spins on a 0 max packet size (mscdex/ssh2#1517)

function intArg(name, v, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} needs a whole number from ${min} to ${max}`);
  return n;
}

function parseArgs(argv) {
  const o = { port: 2222, host: '0.0.0.0', maxPlayers: 8, password: process.env.SCRAP_PASSWORD || '', dataDir: path.join(__dirname, 'data') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--port') { o.port = intArg(a, v, 0, 65535); i++; }
    else if (a === '--host') { o.host = v; i++; }
    else if (a === '--max-players') { o.maxPlayers = intArg(a, v, 1, 8); i++; }   // the rival line fits 7 rivals
    else if (a === '--data-dir') { o.dataDir = path.resolve(v); i++; }
    else if (a === '--help' || a === '-h') { o.help = true; }
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

function hostKey(dataDir) {
  const file = path.join(dataDir, 'host_ed25519');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const { private: priv } = utils.generateKeyPairSync('ed25519');
    fs.writeFileSync(file, priv, { mode: 0o600 });
  }
  return fs.readFileSync(file);
}

function buildGame() {
  const t = resolveTarget(path.join(ROOT, 'games/scrap'));
  return build(t.entry, { manifest: t.manifest, gameDir: t.gameDir });
}

function samePassword(given, want) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(want)).digest();
  return crypto.timingSafeEqual(a, b);
}

function startServer(opts) {
  const game = opts.build || buildGame();
  const store = opts.store !== undefined ? opts.store : (opts.dataDir ? new Store(opts.dataDir) : null);
  const room = new Room({ build: game, store, now: opts.now, maxPlayers: opts.maxPlayers || 8, countdownMs: opts.countdownMs, endScreenMs: opts.endScreenMs, seed: opts.seed });
  const server = new Server({ hostKeys: [opts.hostKey || hostKey(opts.dataDir)], keepaliveInterval: 15000, keepaliveCountMax: 4 }, client => {
    let user = 'robot';
    let fp = null;                   // fingerprint of a key the client proved it holds
    let authFails = 0;
    let sessionTaken = false;
    let member = null;
    const sock = client._sock;       // ssh2 1.17: the raw socket (deadline set on accept, below)
    // Any SSH key the client offers is accepted and, once its signature checks
    // out, names a ranked profile. Clients without a key fall through to
    // keyboard-interactive (no prompt, or the password prompt) and play as guests.
    // 'none' is refused so clients offer their keys first.
    client.on('authentication', ctx => {
      user = ctx.username;
      const methods = fp ? ['password', 'keyboard-interactive'] : ['publickey', 'password', 'keyboard-interactive'];
      const fail = () => {
        if (++authFails >= MAX_AUTH_FAILS) { client.end(); return; }
        ctx.reject(methods);
      };
      if (ctx.method === 'publickey') {
        if (!ctx.signature) return ctx.accept();          // "would you take this key?": yes, now prove it
        let key = utils.parseKey(ctx.key.data);
        if (Array.isArray(key)) key = key[0];
        // The signature must check out against the very key whose fingerprint we keep.
        if (!key || key instanceof Error || key.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true) return fail();
        fp = fingerprint(ctx.key.data);
        if (!opts.password) return ctx.accept();
        return ctx.reject(['password', 'keyboard-interactive'], true);   // key noted; the password is still required
      }
      if (ctx.method === 'password') {
        if (!opts.password) return ctx.accept();
        return samePassword(ctx.password, opts.password) ? ctx.accept() : fail();
      }
      if (ctx.method === 'keyboard-interactive') {
        if (!opts.password) return ctx.accept();
        return ctx.prompt([{ prompt: 'Password: ', echo: false }], answers => {
          if (answers && samePassword(answers[0] || '', opts.password)) ctx.accept(); else fail();
        });
      }
      return ctx.reject(methods);   // 'none' probe: not a failure
    });
    client.on('ready', () => {
      client.on('session', (accept, reject) => {
        if (sessionTaken) return reject();          // one session (one seat) per connection
        sessionTaken = true;
        const session = accept();
        if (!(session._chanInfo.outgoing.packetSize >= MIN_PACKET)) { client.end(); return; }
        const term = { rows: 24, cols: 80, term: 'xterm-256color' };
        session.on('pty', (acc, _rej, info) => {
          term.rows = info.rows; term.cols = info.cols; term.term = String(info.term || term.term);
          acc && acc();
        });
        session.on('window-change', (acc, _rej, info) => {
          term.rows = info.rows; term.cols = info.cols;
          acc && acc();
          if (member) room.resize(member, term.rows, term.cols);
        });
        session.on('shell', acc => {
          const stream = acc && acc();
          if (!stream || member) return;
          if (room.isFull()) { stream.write(T.full); stream.exit(0); stream.end(); client.end(); return; }
          const conn = {
            name: user, fp, rows: term.rows, cols: term.cols,
            colorMode: display.detectColorMode({ TERM: term.term }),
            write: str => {
              if (!str || !stream.writable) return;
              // Guests who stop reading: bound both the channel queue and the TCP
              // queue (a peer can advertise a huge window and never read).
              if (stream.writableLength > MAX_BUFFERED || sock.writableLength > MAX_BUFFERED) { sock.destroy(); return; }
              stream.write(str);
            },
            close: () => { try { stream.write(T.bye); stream.exit(0); stream.end(); } catch (_) { /* gone */ } },
          };
          stream.on('close', () => { if (member) room.leave(member); client.end(); });
          member = room.join(conn);
          clearTimeout(sock.versusDeadline);
          console.log(`[versus] ${member.name} joined${fp ? ' with a key' : ' as a guest'} (${room.members.length} online)`);
          stream.on('data', d => room.input(member, d));
        });
        // exec, subsystem (sftp), env, x11, agent forwarding: no handler, so ssh2 rejects them.
      });
      // tcpip / streamlocal channels and global forwarding requests: no handler, rejected.
    });
    client.on('close', () => { if (member) room.leave(member); });
    client.on('error', e => { if (opts.verbose) console.error('[versus] client error:', e.message); });
  });
  server.maxConnections = Math.max(16, (opts.maxPlayers || 8) * 4);
  // ssh2 creates its client only after the SSH identification line, so a socket
  // that never sends one would hold a connection slot forever: time it out raw.
  // A socket also gets an absolute deadline to reach the lobby, so a trickle of
  // bytes cannot hold a slot either. (ssh2 is pinned; _srv is its net.Server.)
  server._srv.prependListener('connection', sock => {
    sock.setTimeout(IDLE_MS, () => sock.destroy());
    sock.versusDeadline = setTimeout(() => sock.destroy(), ADMIT_MS);
    sock.once('close', () => clearTimeout(sock.versusDeadline));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.removeListener('error', reject);
      server.on('error', e => console.error(`[versus] server error: ${e.message}`));
      resolve({ server, room, port: server.address().port, close: () => { room.close(); server.close(); } });
    });
  });
}

if (require.main === module) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (opts.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 11).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
  startServer(opts).then(({ port }) => {
    console.log(`[versus] SCRAPCORE versus listening on ${opts.host}:${port}${opts.password ? ' (password required)' : ''}`);
    console.log(`[versus] players join with: ssh -p ${port} <name>@<this machine>`);
  }).catch(e => { console.error(`[versus] ${e.message}`); process.exit(1); });
}

module.exports = { startServer, buildGame, parseArgs };
